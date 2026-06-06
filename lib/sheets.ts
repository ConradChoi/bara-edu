import { Course } from '@/lib/types';

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL ?? '';

export async function getAllCourses(): Promise<Course[]> {
  if (!APPS_SCRIPT_URL) return [];
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=courses`, {
      next: { revalidate: 86400 },
    });
    const json = await res.json();
    return (json.data ?? []) as Course[];
  } catch {
    return [];
  }
}

export async function getCourseBySlug(slug: string): Promise<Course | null> {
  if (!APPS_SCRIPT_URL) return null;
  try {
    const res = await fetch(`${APPS_SCRIPT_URL}?action=course&id=${slug}`, {
      next: { revalidate: 86400 },
    });
    const json = await res.json();
    return (json.data ?? null) as Course | null;
  } catch {
    return null;
  }
}
