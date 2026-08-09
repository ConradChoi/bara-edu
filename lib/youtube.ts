// lessons.video_url은 관리자가 자유 입력하는 외부 링크다. 임의 URL을 그대로 iframe에
// 넣지 않기 위해, 인식되는 YouTube 링크만 embed로 변환하고 나머지는 새 창 링크로 폴백한다.
export type YoutubeEmbed = { kind: 'embed'; src: string } | { kind: 'link'; url: string };

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{6,})/,
];

export function getYoutubeEmbed(videoUrl: string | null): YoutubeEmbed | null {
  if (!videoUrl) return null;

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = videoUrl.match(pattern);
    if (match) {
      return { kind: 'embed', src: `https://www.youtube.com/embed/${match[1]}` };
    }
  }

  return { kind: 'link', url: videoUrl };
}
