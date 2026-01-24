"use client";

import type { Contact, Message } from "@/lib/types";
import type { Status } from "./chat-layout";
import { ConnectionView } from "./qr-view";
import { ChatPanel } from "./chat-panel";
import { MessageSquareDashed } from "lucide-react";

interface ChatViewProps {
  status: Status;
  contact: Contact | null;
  messages: Message[];
  onSendMessage: (content: string, contactId: string) => void;
  isAiReplying: boolean;
  onConnect: (phoneNumber: string) => void;
  pairingCode: string | null;
}

export function ChatView({ status, contact, messages, onSendMessage, isAiReplying, onConnect, pairingCode }: ChatViewProps) {
  if (status !== "connected") {
    return <ConnectionView status={status} onConnect={onConnect} pairingCode={pairingCode} />;
  }

  if (!contact) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-card">
        <MessageSquareDashed className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h2 className="text-2xl font-headline font-bold">Welcome to ChatMate AI</h2>
          <p className="text-muted-foreground">Select a contact from the list to start chatting.</p>
        </div>
      </div>
    );
  }

  return (
    <ChatPanel
      key={contact.id}
      contact={contact}
      messages={messages}
      onSendMessage={onSendMessage}
      isAiReplying={isAiReplying}
    />
  );
}
