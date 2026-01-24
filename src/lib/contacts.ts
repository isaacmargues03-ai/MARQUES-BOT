import type { Contact, User } from "./types";

export const MOCK_CONTACTS: Contact[] = [
  { id: "1", name: "Sarah Connor", avatar: "https://picsum.photos/seed/1/40/40", bio: "Protecting the future." },
  { id: "2", name: "John Doe", avatar: "https://picsum.photos/seed/2/40/40", bio: "Just a regular guy." },
  { id: "3", name: "Jane Smith", avatar: "https://picsum.photos/seed/3/40/40", bio: "Lover of coffee and code." },
  { id: "4", name: "Cyberdyne Systems", avatar: "https://picsum.photos/seed/4/40/40", bio: "Building a better tomorrow." },
  { id: "5", name: "Tech Innovations", avatar: "https://picsum.photos/seed/5/40/40", bio: "Innovate. Create. Inspire." },
  { id: "6", name: "Alex Williams", avatar: "https://picsum.photos/seed/6/40/40", bio: "Adventurer and photographer." },
];

export const MOCK_USER: User = {
  id: "me",
  name: "Marques Bot",
  avatar: "https://picsum.photos/seed/me/40/40",
};
