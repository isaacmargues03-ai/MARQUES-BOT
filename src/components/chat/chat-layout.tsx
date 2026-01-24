"use client";

import React, { useState } from "react";
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ContactList } from "@/components/chat/contact-list";
import { ChatView } from "@/components/chat/chat-view";
import { MOCK_CONTACTS, MOCK_USER } from "@/lib/contacts";
import type { Contact, Message } from "@/lib/types";
import { automatedResponse } from "@/ai/flows/automated-responses";
import { useToast } from "@/hooks/use-toast";

export type Status = "unauthenticated" | "connecting" | "authentication_successful" | "connected" | "disconnected";

export function ChatLayout() {
  const [status, setStatus] = useState<Status>("unauthenticated");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [activeContactId, setActiveContactId] = useState<string | null>(null);
  const [messagesByContact, setMessagesByContact] = useState<Record<string, Message[]>>({});
  const [isAiReplying, setIsAiReplying] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const handleConnect = (phoneNumber: string) => {
    setStatus("connecting");
    // Simulate API call to get a pairing code
    setTimeout(() => {
      const fakeCode = Math.random().toString(36).substring(2, 8).toUpperCase().match(/.{1,3}/g)!.join('-');
      setPairingCode(fakeCode);
      setStatus("authentication_successful");

      // Simulate waiting for user to enter the code on their device
      setTimeout(() => {
        setStatus("connected");
      }, 5000);

    }, 2000);
  };

  const activeContact = MOCK_CONTACTS.find((c) => c.id === activeContactId) || null;

  const addMessage = (contactId: string, message: Message) => {
    setMessagesByContact((prev) => ({
      ...prev,
      [contactId]: [...(prev[contactId] || []), message],
    }));
  };

  const handleSendMessage = async (content: string, contactId: string) => {
    const contact = MOCK_CONTACTS.find(c => c.id === contactId);
    if (!contact) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      content,
      senderId: "me",
      timestamp: new Date(),
    };
    addMessage(contactId, userMessage);
    
    // Simulate contact's reply and trigger AI
    setTimeout(() => {
      const contactReply: Message = {
        id: crypto.randomUUID(),
        content: `Thanks for the message! I'll get back to you.`,
        senderId: contactId,
        timestamp: new Date(),
      };
      addMessage(contactId, contactReply);
      triggerAiResponse(contactReply, contact);
    }, 1000 + Math.random() * 500);
  };
  
  const triggerAiResponse = async (incomingMessage: Message, contact: Contact) => {
    setIsAiReplying(prev => ({...prev, [contact.id]: true}));
    try {
      const response = await automatedResponse({
        messageContent: incomingMessage.content,
        contactName: contact.name,
      });

      if (response && response.response) {
        const aiMessage: Message = {
          id: crypto.randomUUID(),
          content: response.response,
          senderId: "me",
          timestamp: new Date(),
          isAiResponse: true,
        };
        addMessage(contact.id, aiMessage);
      }
    } catch (error) {
      console.error("AI response failed:", error);
      toast({
        variant: "destructive",
        title: "AI Error",
        description: "The automated response failed. Please try again.",
      });
    } finally {
      setIsAiReplying(prev => ({...prev, [contact.id]: false}));
    }
  };


  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex h-screen">
        <Sidebar
          variant="sidebar"
          collapsible="icon"
          className="group-data-[collapsible=icon]:-ml-1 dark:bg-background bg-sidebar-background dark:text-sidebar-foreground text-sidebar-foreground"
        >
          <ContactList
            user={MOCK_USER}
            contacts={MOCK_CONTACTS}
            activeContactId={activeContactId}
            onContactSelect={(id) => setActiveContactId(id)}
          />
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <ChatView
            status={status}
            contact={activeContact}
            messages={messagesByContact[activeContactId || ""] || []}
            onSendMessage={handleSendMessage}
            isAiReplying={isAiReplying[activeContactId || ""] || false}
            onConnect={handleConnect}
            pairingCode={pairingCode}
          />
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
