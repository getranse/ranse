export interface HelpArticleSummary {
  id: string;
  title: string;
  updated_at: number | null;
}

export interface HelpArticle {
  title: string;
  sections: Array<{ title: string; body: string }>;
}
