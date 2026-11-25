-- 운영 DB 패치: R24 (2026-11-25) — 퀴즈 함수 2개 교체
--
-- 대상: public.get_quiz_for_lesson, public.submit_quiz_attempt (api/db/02-schema.sql의 같은 정의와 동일, 동기화 테스트로 확인)
-- 변경: 정답이 설정되지 않은 문항은 조회·채점에서 제외 / 한 문항에 선택지를 둘 이상 고르면 거부 /
--       같은 회원·강의의 동시 제출을 advisory lock으로 직렬화해 attempt_no 중복 방지
-- 성격: create or replace function만 담았다. 멱등(여러 번 실행해도 같은 결과), 테이블·인덱스·정책·트리거·데이터 변경 없음,
--       기존 grant 유지. `npm run db:migrate`(스키마 전체 재실행)는 쓰지 않는다.
-- 적용: psql "$DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f api/db/patches/2026-11-25-r24.sql
--       (관리자 권한 연결, 함수 소유자와 같은 역할)
-- 배포 순서: 이 패치 -> API -> 앱 (함수는 옛 앱·옛 API와도 호환된다)

create or replace function public.get_quiz_for_lesson(p_lesson_id uuid)
returns table (
  question_id uuid,
  question text,
  question_order integer,
  option_id uuid,
  option_label text,
  option_order integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from lessons l
    join enrollments e on e.course_id = l.course_id
    where l.id = p_lesson_id and e.user_id = v_user_id and e.status = 'approved'
  ) then
    raise exception 'not enrolled or not approved';
  end if;

  return query
    select q.id, q.question, q."order", o.id, o.label, o."order"
    from quiz_questions q
    join quiz_options o on o.question_id = q.id
    -- 정답이 설정되지 않은 문항은 채점할 수 없으므로 보여 주지 않는다(submit_quiz_attempt의 채점 대상과 같은 규칙, 2026-11-25)
    where q.lesson_id = p_lesson_id
      and exists (select 1 from quiz_options c where c.question_id = q.id and c.is_correct)
    order by q."order", o."order";
end;
$$;

create or replace function public.submit_quiz_attempt(p_lesson_id uuid, p_selected_option_ids uuid[])
returns table (
  attempt_no integer,
  score integer,
  correct_count integer,
  total_questions integer,
  results jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_total_questions integer;
  v_correct_count integer;
  v_score integer;
  v_next_attempt integer;
  v_results jsonb;
begin
  if v_user_id is null or not is_active_learner() then
    raise exception 'not authorized';
  end if;

  if not exists (
    select 1 from lessons l
    join enrollments e on e.course_id = l.course_id
    where l.id = p_lesson_id and e.user_id = v_user_id and e.status = 'approved'
  ) then
    raise exception 'not enrolled or not approved';
  end if;

  -- 채점 대상은 정답이 설정된 문항뿐이다(2026-11-25). 예전에는 정답 없는 문항이 total_questions에는 세어지고
  -- results·정답 수에서는 빠져 100점이 불가능했다. get_quiz_for_lesson도 같은 문항만 보여 준다.
  select count(*) into v_total_questions
  from quiz_questions q
  where q.lesson_id = p_lesson_id
    and exists (select 1 from quiz_options c where c.question_id = q.id and c.is_correct);
  if v_total_questions = 0 then
    raise exception 'quiz not found for lesson';
  end if;

  -- 한 문항에 선택지를 둘 이상 고르는 요청은 채점이 모호하므로 거부한다(같은 id의 중복은 하나로 본다)
  if exists (
    select 1
    from quiz_questions q
    join quiz_options o on o.question_id = q.id
    where q.lesson_id = p_lesson_id and o.id = any(coalesce(p_selected_option_ids, '{}'::uuid[]))
    group by q.id
    having count(distinct o.id) > 1
  ) then
    raise exception 'multiple options selected for one question';
  end if;

  select
    jsonb_agg(jsonb_build_object(
      'questionId', q.id,
      'selectedOptionId', sel.option_id,
      'isCorrect', (sel.option_id is not null and sel.option_id = correct_opt.id)
    ) order by q."order"),
    count(*) filter (where sel.option_id is not null and sel.option_id = correct_opt.id)
  into v_results, v_correct_count
  from quiz_questions q
  join quiz_options correct_opt on correct_opt.question_id = q.id and correct_opt.is_correct = true
  left join lateral (
    select o.id as option_id
    from quiz_options o
    where o.question_id = q.id and o.id = any(p_selected_option_ids)
    limit 1
  ) sel on true
  where q.lesson_id = p_lesson_id;

  v_score := round(100.0 * v_correct_count / v_total_questions);

  -- 같은 회원이 같은 강의에 동시에 제출해도 attempt_no가 겹치지 않도록 (회원, 강의) 단위로 직렬화한다(2026-11-25).
  -- 기존 데이터에 이미 겹친 번호가 있을 수 있어 unique 제약 대신 잠금을 쓴다(제약을 걸면 기존 중복 때문에 적용이 실패).
  perform pg_advisory_xact_lock(hashtextextended('quiz_attempt:' || v_user_id::text || ':' || p_lesson_id::text, 0));

  select coalesce(max(qs.attempt_no), 0) + 1 into v_next_attempt
  from quiz_submissions qs
  where qs.user_id = v_user_id and qs.lesson_id = p_lesson_id;

  insert into quiz_submissions (user_id, lesson_id, score, attempt_no)
  values (v_user_id, p_lesson_id, v_score, v_next_attempt);

  return query select v_next_attempt, v_score, v_correct_count, v_total_questions, v_results;
end;
$$;
