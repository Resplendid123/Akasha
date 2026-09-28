export interface IRecentPageVisit {
  id: string;
  pageId: string;
  lastVisitedAt: string;
  page: {
    title: string | null;
    icon: string | null;
    slugId: string;
  };
  space: {
    id: string;
    name: string | null;
    slug: string;
    logo: string | null;
  };
}
