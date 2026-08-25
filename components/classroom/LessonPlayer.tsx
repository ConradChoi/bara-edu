import { formatKstDisplay } from '@/lib/kst';
import { getYoutubeEmbed } from '@/lib/youtube';
import type { Lesson } from '@/lib/types';

// F-LRN-2: 강의 방식(lessonMode)별로 다르게 보여준다.
// - video(기본): 외부 링크 임베드(업로드 아님). 인식되는 YouTube 링크만 iframe, 그 외엔 새 창 링크로 폴백.
// - online: 실시간 화상수업 참여 링크(+선택 일시)를 버튼으로 안내.
// - offline: 장소명/주소를 안내 텍스트로 보여준다(둘 다 선택 입력이라 비어있을 수 있음).
export default function LessonPlayer({
  lessonMode,
  videoUrl,
  onlineMeetingUrl,
  onlineScheduledAt,
  offlineLocationName,
  offlineAddress,
}: Pick<Lesson, 'lessonMode' | 'videoUrl' | 'onlineMeetingUrl' | 'onlineScheduledAt' | 'offlineLocationName' | 'offlineAddress'>) {
  if (lessonMode === 'online') {
    const scheduledDisplay = formatKstDisplay(onlineScheduledAt);
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg bg-n-2 px-6 text-center">
        <span className="text-[13px] font-medium text-n-7">온라인 수업이에요</span>
        {scheduledDisplay && <span className="text-[13px] text-n-6">예정 일시 {scheduledDisplay}</span>}
        {onlineMeetingUrl ? (
          <a
            href={onlineMeetingUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-pill bg-pink px-6 py-2.5 text-[14px] font-semibold text-white"
          >
            회의 참여하기
          </a>
        ) : (
          <span className="text-[13px] text-n-6">아직 참여 링크가 등록되지 않았어요</span>
        )}
      </div>
    );
  }

  if (lessonMode === 'offline') {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-n-2 px-6 text-center">
        <span className="text-[13px] font-medium text-n-7">오프라인 수업이에요</span>
        {offlineLocationName && <span className="text-[13px] text-n-6">{offlineLocationName}</span>}
        {offlineAddress && <span className="text-[13px] text-n-6">{offlineAddress}</span>}
        {!offlineLocationName && !offlineAddress && (
          <span className="text-[13px] text-n-6">자세한 장소는 별도 공지로 안내드려요</span>
        )}
      </div>
    );
  }

  const embed = getYoutubeEmbed(videoUrl);

  if (!embed) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-n-2 text-[13px] text-n-6">
        등록된 영상이 없어요
      </div>
    );
  }

  if (embed.kind === 'embed') {
    return (
      <div className="aspect-video overflow-hidden rounded-lg bg-n-9">
        <iframe
          src={embed.src}
          title="강의 영상"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-n-2 text-[13px] text-n-6">
      <span>이 영상은 여기서 바로 재생할 수 없어요</span>
      <a href={embed.url} target="_blank" rel="noreferrer" className="font-medium text-pink underline">
        새 창에서 보기
      </a>
    </div>
  );
}
