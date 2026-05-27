export interface MyProfile {
  name: string;
  email: string;
  signature_markdown: string;
  avatar_url: string;
}

export type ProfileInput = Partial<Pick<MyProfile, 'name' | 'signature_markdown' | 'avatar_url'>>;
