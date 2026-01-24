# **App Name**: ChatMate AI

## Core Features:

- Message Receiving: Receive messages via WhatsApp using the Baileys library.
- Automated Responses: Send automated responses to incoming messages. The LLM can use the tool of inspecting the incoming message's contents, and decide whether it contains specific commands, or can be understood with simple rules, or whether it requires further reasoning about the appropriate kind of reply.
- Contact Management: List all the user's saved contacts, using their WhatsApp names.
- Status Updates: Display current status of the bot: connected, disconnected, etc.
- QR Code Authentication: Display a QR code for WhatsApp Web authentication using qrcode-terminal.

## Style Guidelines:

- Primary color: Deep indigo (#3F51B5) to represent reliability and intelligence in the chat interface.
- Background color: Very light indigo (#E8EAF6), almost white, providing a gentle contrast.
- Accent color: Vivid orange (#FF5722) for user prompts, bot actions, and interactive elements, clearly distinct.
- Headline font: 'Space Grotesk', sans-serif, to reflect the app's tech-forward functionality.
- Body font: 'Inter', sans-serif, to ensure comfortable readability across devices.
- Code Font: 'Source Code Pro' for the times that snippets of program code need to be rendered.
- Use simple, outlined icons from a consistent set (e.g., Material Icons) to maintain a clean and modern aesthetic.
- Implement a clean, single-column layout, placing user input at the bottom, conversation history in the middle, and status/controls at the top.
- Subtle transitions for loading messages and status changes.