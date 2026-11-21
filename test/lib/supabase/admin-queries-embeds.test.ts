import { beforeEach, expect, test, vi } from 'vitest';

type Body = { table: string; select?: string; filters?: { col: string; op: string; value: unknown }[] };
const tables: Record<string, unknown[]> = {};
const bodies: Body[] = [];
vi.mock('@/lib/db/api', () => ({
  apiFetch: async (_path: string, init: { body: Body }) => {
    bodies.push(init.body);
    return { ok: true, data: { data: tables[init.body.table] ?? [], count: null } };
  },
}));
vi.mock('@/lib/db/session-cookie', () => ({ readSession: async () => 'tok' }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => ({ get: () => null }), cookies: async () => ({}) }));

import {
  getAdminAssignmentSubmissions,
  getCertificatePendingLearners,
  getCourseExamQuestionsForCourse,
} from '@/lib/supabase/admin-queries';

const queried = (table: string) => bodies.filter((b) => b.table === table);

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  bodies.length = 0;
});

test('승인 신청 진도 통계: 강좌별 강의·시험문항을 따로 조회해 붙이고, 강의 없는 강좌는 제외', async () => {
  tables.enrollments = [
    { user_id: 'u1', course_id: 'c1', profiles: { name: '홍길동' }, courses: { title: 'A', requires_exam: true, exam_max_attempts: 2 } },
    { user_id: 'u2', course_id: 'c1', profiles: { name: '김철수' }, courses: { title: 'A', requires_exam: true, exam_max_attempts: 2 } },
    { user_id: 'u1', course_id: 'c2', profiles: { name: '홍길동' }, courses: { title: 'B', requires_exam: false, exam_max_attempts: null } },
  ];
  tables.lessons = [
    { id: 'l1', course_id: 'c1', has_assignment: true },
    { id: 'l2', course_id: 'c1', has_assignment: false },
  ];
  tables.course_exam_question_links = [{ id: 'q1', course_id: 'c1' }];
  tables.progress = [{ user_id: 'u1', lesson_id: 'l1' }];

  expect(await getCertificatePendingLearners()).toEqual([
    {
      userId: 'u1', userName: '홍길동', courseId: 'c1', courseTitle: 'A', completedLessons: 1, totalLessons: 2,
      pendingAssignmentCount: 1, requiresExam: true, examState: 'not_attempted', examAttemptsSinceReset: 0, examMaxAttempts: 2,
      reasons: ['progress', 'assignment', 'exam'],
    },
    {
      userId: 'u2', userName: '김철수', courseId: 'c1', courseTitle: 'A', completedLessons: 0, totalLessons: 2,
      pendingAssignmentCount: 1, requiresExam: true, examState: 'not_attempted', examAttemptsSinceReset: 0, examMaxAttempts: 2,
      reasons: ['progress', 'assignment', 'exam'],
    },
  ]);
  expect(queried('enrollments')[0].select).toBe('user_id, course_id, profiles(name), courses(title, requires_exam, exam_max_attempts)');
  expect(queried('lessons')[0].filters).toEqual([{ col: 'course_id', op: 'in', value: ['c1', 'c2'] }]);
  expect(queried('course_exam_question_links')[0].filters).toEqual([{ col: 'course_id', op: 'in', value: ['c1', 'c2'] }]);
});

test('승인 신청이 없으면 강의·시험문항 조회를 건너뛴다', async () => {
  expect(await getCertificatePendingLearners()).toEqual([]);
  expect(queried('lessons')).toEqual([]);
  expect(queried('course_exam_question_links')).toEqual([]);
});

test('강좌 시험 문항: 보기를 따로 조회해 순서대로 붙이고, 보기 없는 문항은 빈 배열', async () => {
  tables.course_exam_question_links = [
    { id: 'k1', bank_question_id: 'b1', order: 1, exam_question_bank: { question: 'Q1', question_type: 'multiple_choice', answer_text: null } },
    { id: 'k2', bank_question_id: 'b2', order: 2, exam_question_bank: { question: 'Q2', question_type: 'short_answer', answer_text: '정답' } },
  ];
  tables.exam_bank_options = [
    { id: 'o2', bank_question_id: 'b1', label: '나', is_correct: true, order: 2 },
    { id: 'o1', bank_question_id: 'b1', label: '가', is_correct: false, order: 1 },
  ];
  expect(await getCourseExamQuestionsForCourse('c1')).toEqual([
    {
      linkId: 'k1', bankQuestionId: 'b1', question: 'Q1', order: 1, questionType: 'multiple_choice', answerText: null,
      options: [
        { id: 'o1', label: '가', order: 1, isCorrect: false },
        { id: 'o2', label: '나', order: 2, isCorrect: true },
      ],
    },
    { linkId: 'k2', bankQuestionId: 'b2', question: 'Q2', order: 2, questionType: 'short_answer', answerText: '정답', options: [] },
  ]);
  expect(queried('course_exam_question_links')[0].select).toBe('id, bank_question_id, order, exam_question_bank(question, question_type, answer_text)');
  expect(queried('exam_bank_options')[0].filters).toEqual([{ col: 'bank_question_id', op: 'in', value: ['b1', 'b2'] }]);
});

test('강좌 시험 문항이 없으면 보기 조회를 건너뛴다', async () => {
  expect(await getCourseExamQuestionsForCourse('c1')).toEqual([]);
  expect(queried('exam_bank_options')).toEqual([]);
});

test('과제 제출 목록: 강좌 제목을 따로 조회해 붙이고, 최신 제출만·상태 필터 유지', async () => {
  const base = { content: 'x', is_late: false, review_note: null };
  tables.assignment_submissions = [
    { ...base, id: 's3', user_id: 'u1', lesson_id: 'l1', status: 'submitted', submitted_at: '2026-11-03', profiles: { name: '홍길동', email: null }, lessons: { title: '1강', course_id: 'c1' } },
    { ...base, id: 's1', user_id: 'u1', lesson_id: 'l1', status: 'rejected', submitted_at: '2026-11-01', profiles: { name: '홍길동', email: null }, lessons: { title: '1강', course_id: 'c1' } },
    { ...base, id: 's2', user_id: 'u2', lesson_id: 'l2', status: 'approved', submitted_at: '2026-11-02', profiles: { name: '김철수', email: 'k@b.kr' }, lessons: { title: '2강', course_id: 'c2' } },
  ];
  tables.courses = [
    { id: 'c1', title: 'A' },
    { id: 'c2', title: 'B' },
  ];
  expect(await getAdminAssignmentSubmissions()).toEqual([
    { id: 's3', userId: 'u1', userName: '홍길동', userEmail: null, lessonId: 'l1', lessonTitle: '1강', courseId: 'c1', courseTitle: 'A', status: 'submitted', content: 'x', isLate: false, submittedAt: '2026-11-03', reviewNote: null },
    { id: 's2', userId: 'u2', userName: '김철수', userEmail: 'k@b.kr', lessonId: 'l2', lessonTitle: '2강', courseId: 'c2', courseTitle: 'B', status: 'approved', content: 'x', isLate: false, submittedAt: '2026-11-02', reviewNote: null },
  ]);
  expect(queried('assignment_submissions')[0].select).toBe(
    'id, user_id, lesson_id, status, content, is_late, submitted_at, review_note, profiles(name, email), lessons(title, course_id)',
  );
  expect(queried('courses')[0].filters).toEqual([{ col: 'id', op: 'in', value: ['c1', 'c2'] }]);
  expect((await getAdminAssignmentSubmissions({ status: 'approved' })).map((r) => r.id)).toEqual(['s2']);
});

test('과제 제출이 없으면 강좌 조회를 건너뛴다', async () => {
  expect(await getAdminAssignmentSubmissions()).toEqual([]);
  expect(queried('courses')).toEqual([]);
});
