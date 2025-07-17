export default function handler(request, response) {
    // Ensure this function only runs on the server and is not bundled with the client-side code.
    if (typeof window !== 'undefined') {
        return response.status(403).json({ error: 'This API route is server-side only.' });
    }

    const firebaseConfig = {
        apiKey: process.env.VITE_API_KEY,
        authDomain: process.env.VITE_AUTH_DOMAIN,
        projectId: process.env.VITE_PROJECT_ID,
        storageBucket: process.env.VITE_STORAGE_BUCKET,
        messagingSenderId: process.env.VITE_MESSAGING_SENDER_ID,
        appId: process.env.VITE_APP_ID,
    };

    const geminiApiKey = process.env.VITE_GEMINI_API_KEY;

    // Basic validation to ensure environment variables are loaded
    if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !geminiApiKey) {
        console.error('Vercel Environment Variables are missing!');
        return response.status(500).json({ error: 'Server configuration error. Required environment variables are not set.' });
    }

    response.status(200).json({
        firebaseConfig,
        geminiApiKey,
    });
} 