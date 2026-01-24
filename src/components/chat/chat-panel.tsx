"use client";

import { useState } from "react";
import type { Contact, Message } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot } from "lucide-react";
import { MessageList } from "./message-list";
import { StatusIndicator } from "./status-indicator";

interface ChatPanelProps {
  contact: Contact;
  messages: Message[];
  onSendMessage: (content: string, contactId: string) => void;
  isAiReplying: boolean;
}

export function ChatPanel({ contact, messages, onSendMessage, isAiReplying }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onSendMessage(inputValue, contact.id);
      setInputValue("");
    }
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <header className="flex items-center gap-4 border-b p-4">
        <Avatar>
          <AvatarImage src={contact.avatar} alt={contact.name} />
          <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h2 className="font-headline text-lg font-semibold">{contact.name}</h2>
          <p className="text-sm text-muted-foreground">{contact.bio}</p>
        </div>
        <StatusIndicator status="connected" />
      </header>

      <MessageList messages={messages} contact={contact} isAiReplying={isAiReplying} />

      <footer className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Send a message..."
            className="flex-1"
            autoComplete="off"
          />
          <Button type="submit" size="icon" className="bg-primary hover:bg-primary/90">
            <Send className="h-5 w-5" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
         <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
            <Bot className="h-3 w-3" />
            <span>AI-powered responses are enabled for this chat.</span>
          </p>
      </footer>
    </div>
  );
}
