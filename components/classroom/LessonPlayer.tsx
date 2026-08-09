import { getYoutubeEmbed } from '@/lib/youtube';

// F-LRN-2: 외부 링크 임베드(업로드 아님). 인식되는 YouTube 링크만 iframe, 그 외엔 새 창 링크로 폴백.
export default function LessonPlayer({ videoUrl }: { videoUrl: string | null }) {
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
