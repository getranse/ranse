import type { MyProfile } from '../../interfaces/profile';
export type { MyProfile };


export type ProfileInput = Partial<Pick<MyProfile, 'name' | 'signature_markdown' | 'avatar_url'>>;
