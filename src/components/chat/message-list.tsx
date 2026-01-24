"use client";

import { useEffect, useRef } from "react";
import type { Contact, Message } from "@/lib/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { Bot } from "lucide-react";

interface MessageListProps {
  messages: Message[];
  contact: Contact;
  isAiReplying: boolean;
}

export function MessageList({ messages, contact, isAiReplying }: MessageListProps) {
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({
        top: scrollAreaRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [messages, isAiReplying]);

  return (
    <ScrollArea className="flex-1" ref={scrollAreaRef}>
      <div className="p-4 space-y-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} contact={contact} />
        ))}
        {isAiReplying && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
            <Bot className="h-4 w-4" />
            <span>AI is replying...</span>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
