export interface Team {
  id: string;
  name: string;
  created_at: number;
  member_count: number;
}

export interface TeamMemberRow {
  user_id: string;
  email: string;
  name: string | null;
}
