export type Contact = {
  id: string;
  name: string;
  avatar: string;
  bio: string;
};

export type User = {
  id: 'me';
  name: string;
  avatar: string;
};

export type Message = {
  id: string;
  content: string;
  senderId: 'me' | string;
  timestamp: Date;
  isAiResponse?: boolean;
};
