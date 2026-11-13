import { siteConfig } from '@/data/site-config';

export interface NoticeConfig {
  /**
   * 공지 고유 ID
   * 공지 내용을 새로 변경했을 때 ID를 변경(예: notice-2026-02)하면,
   * 이전에 '오늘 하루 보지 않기'를 누른 방문자에게도 새로운 공지가 다시 노출됩니다.
   */
  id: string;

  /** 공지 팝업 활성화 여부 (false로 설정 시 팝업이 노출되지 않습니다) */
  enabled: boolean;

  /**
   * 노출 종료 시각(ISO 8601, KST 오프셋 포함). 이 시각부터는 enabled와 무관하게 숨겨집니다.
   * 기간 연장 시 이 값만 바꾸면 됩니다(같은 공지라면 id는 그대로 둡니다).
   */
  endsAt?: string;

  /** 상단 배지 라벨 (예: '공지사항', '안내', '이벤트' 등) */
  badge?: string;

  /** 공지 팝업 제목 */
  title: string;

  /** 공지 팝업 본문 (줄바꿈 지원) */
  content: string;

  /** 바로가기 링크 버튼 (선택 사항) */
  link?: {
    text: string;
    href: string;
    isExternal?: boolean;
  };
}

export const defaultNoticeConfig: NoticeConfig = {
  id: 'notice-2026-service-migration',
  enabled: true,
  endsAt: '2026-12-01T00:00:00+09:00',
  badge: '공지사항',
  title: '서비스 환경 이전 작업 안내',
  content: `더 안정적인 서비스를 위해 서버 환경 구축과 데이터 이전 작업을 진행합니다.

• 작업 기간: 2026년 11월 14일(토) ~ 11월 30일(월)
• 기간 중 하루 새벽에 1~2시간 정도 서비스 이용이 잠시 중단될 수 있어요. 정확한 일시는 다시 안내드릴게요.
• 이전이 끝나면 다시 로그인해 주세요.
• 이전 전에 받은 인증·비밀번호 재설정 메일 링크는 사용할 수 없어요. 필요하면 다시 요청해 주세요.

문의: ${siteConfig.phone}`,
};
