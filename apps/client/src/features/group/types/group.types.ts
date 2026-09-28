export interface IGroup {
  groupId: string;
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  creatorId: string | null;
  workspaceId: string;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
}

export interface IGroupTreeMember {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
}

export interface IGroupTreeNode {
  id: string;
  name: string;
  displayName: string;
  memberCount: number;
  isDefault: boolean;
  isExternal: boolean;
  children: IGroupTreeNode[];
  members: IGroupTreeMember[];
}
