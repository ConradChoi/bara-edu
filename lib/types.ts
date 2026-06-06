export interface Course {
  id: string;
  title: string;
  category: CourseCategory;
  description: string;
  curriculum: string[];
  instructor: string;
  instructorBio?: string;
  startDate: string;
  endDate: string;
  schedule: string;
  fee: number;
  seats: number;
  governmentSupport: boolean;
  formUrl: string;
  thumbnail?: string;
  status: CourseStatus;
}

export type CourseCategory =
  | 'IT/디지털'
  | '외국어'
  | '자격증'
  | '직무역량'
  | '취미/교양'
  | '정부지원';

export type CourseStatus = 'active' | 'upcoming' | 'closed';

export interface SiteConfig {
  name: string;
  phone: string;
  email: string;
  address: string;
  kakaoUrl?: string;
  instagramUrl?: string;
  openingDate?: string;
  isOpen: boolean;
}
