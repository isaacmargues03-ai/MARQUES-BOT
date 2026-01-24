"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader, Smartphone } from "lucide-react";
import type { Status } from "./chat-layout";
import { useState } from "react";

interface ConnectionViewProps {
  status: Status;
  onConnect: (phoneNumber: string) => void;
  pairingCode: string | null;
}

export function ConnectionView({ status, onConnect, pairingCode }: ConnectionViewProps) {
  const [phoneNumber, setPhoneNumber] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneNumber) {
      onConnect(phoneNumber);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-secondary">
      <Card className="w-full max-w-md shadow-2xl">
        <CardHeader className="text-center">
          <CardTitle className="font-headline text-3xl">Connect to WhatsApp</CardTitle>
          <CardDescription>
            {status === "unauthenticated"
              ? "Enter your phone number to generate a pairing code."
              : "Follow the steps to connect your device."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-6">
          
          {status === 'unauthenticated' && (
            <form onSubmit={handleSubmit} className="w-full space-y-4 p-4">
              <div className="relative">
                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  type="tel"
                  placeholder="e.g. 5521991654183"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
              <Button type="submit" className="w-full bg-primary hover:bg-primary/90">
                Get Pairing Code
              </Button>
            </form>
          )}

          {status === 'connecting' && (
             <div className="flex flex-col items-center justify-center gap-4 p-8">
                <Loader className="h-16 w-16 animate-spin text-primary" />
                <p className="font-semibold text-primary">Generating code...</p>
            </div>
          )}

          {status === 'authentication_successful' && pairingCode && (
             <div className="flex flex-col items-center justify-center gap-4 p-8">
                <p className="text-sm text-muted-foreground">Enter this code on your device:</p>
                <div className="bg-primary text-primary-foreground text-4xl font-bold tracking-widest p-4 rounded-lg">
                    {pairingCode}
                </div>
                <p className="font-semibold text-muted-foreground animate-pulse mt-4">Waiting for connection...</p>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
