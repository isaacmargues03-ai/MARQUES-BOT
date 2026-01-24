'use server';
/**
 * @fileOverview A flow that automatically responds to incoming messages using GenAI.
 *
 * - automatedResponse - A function that handles the automatic response to incoming messages.
 * - AutomatedResponseInput - The input type for the automatedResponse function.
 * - AutomatedResponseOutput - The return type for the automatedResponse function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AutomatedResponseInputSchema = z.object({
  messageContent: z.string().describe('The content of the incoming message.'),
  contactName: z.string().describe('The name of the contact sending the message.'),
});
export type AutomatedResponseInput = z.infer<typeof AutomatedResponseInputSchema>;

const AutomatedResponseOutputSchema = z.object({
  response: z.string().describe('The automated response to the message.'),
});
export type AutomatedResponseOutput = z.infer<typeof AutomatedResponseOutputSchema>;

export async function automatedResponse(input: AutomatedResponseInput): Promise<AutomatedResponseOutput> {
  return automatedResponseFlow(input);
}

const prompt = ai.definePrompt({
  name: 'automatedResponsePrompt',
  input: {schema: AutomatedResponseInputSchema},
  output: {schema: AutomatedResponseOutputSchema},
  prompt: `You are a helpful AI assistant designed to respond to messages on behalf of the user.

  The incoming message is from {{contactName}} and contains the following content:
  {{messageContent}}

  Based on the message content, formulate an appropriate and engaging reply. Consider whether the message contains specific commands, can be understood with simple rules, or requires further reasoning.  Try to mimic human conversation as much as possible, use emojis where applicable.
  Response:`,
});

const automatedResponseFlow = ai.defineFlow(
  {
    name: 'automatedResponseFlow',
    inputSchema: AutomatedResponseInputSchema,
    outputSchema: AutomatedResponseOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
