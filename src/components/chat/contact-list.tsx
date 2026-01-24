"use client";
import type { Contact, User } from "@/lib/types";
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Settings, LogOut } from "lucide-react";
import { AppLogo } from "@/components/icons";

interface ContactListProps {
  user: User;
  contacts: Contact[];
  activeContactId: string | null;
  onContactSelect: (id: string) => void;
}

export function ContactList({ user, contacts, activeContactId, onContactSelect }: ContactListProps) {
  return (
    <>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <AppLogo className="size-8 text-primary" />
          <div className="flex flex-col">
            <h2 className="font-headline text-lg font-semibold tracking-tight text-primary-foreground">
              ChatMate AI
            </h2>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent className="p-2">
        <SidebarMenu>
          {contacts.map((contact) => (
            <SidebarMenuItem key={contact.id}>
              <SidebarMenuButton
                onClick={() => onContactSelect(contact.id)}
                isActive={activeContactId === contact.id}
                className="justify-start"
                tooltip={{ children: contact.name, side: "right", className: "dark:bg-popover bg-popover text-popover-foreground" }}
              >
                <Avatar className="h-6 w-6">
                  <AvatarImage src={contact.avatar} alt={contact.name} />
                  <AvatarFallback>{contact.name.charAt(0)}</AvatarFallback>
                </Avatar>
                <span className="truncate">{contact.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton className="justify-start" tooltip={{ children: "Settings", side: "right", className: "dark:bg-popover bg-popover text-popover-foreground" }}>
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton className="justify-start" tooltip={{ children: user.name, side: "right", className: "dark:bg-popover bg-popover text-popover-foreground" }}>
              <Avatar className="h-6 w-6">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
              </Avatar>
              <span className="truncate">{user.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}
