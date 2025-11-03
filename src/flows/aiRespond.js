// aiRespond.js

// Existing logic and imports - preserve them
// e.g. const { callModel } = require('./modelApi');

// List of models to use in cascade, strongest first
const models = ['gpt-4', 'gpt-3.5-turbo', 'gpt-3.0'];

// Function to call a model (placeholder - existing implementation should be used)
async function callModel(modelName, prompt, userData) {
    // This function should call the AI model API
    // Example: return await modelApi.generate(modelName, prompt, userData);
    // Placeholder implementation:
    return `Response from ${modelName} for prompt: ${prompt}`;
}

// Cascade models with fallback
async function getResponseWithCascade(prompt, userData) {
    for (const model of models) {
        try {
            const response = await callModel(model, prompt, userData);
            if (response) {
                return response;
            }
        } catch (error) {
            console.warn(`Model ${model} failed. Trying next.`, error);
            continue;
        }
    }
    throw new Error('All models failed to generate a response.');
}

// Detect if message contains an emoji
function containsEmoji(message) {
    // A simple regex to detect most emojis
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u;
    return emojiRegex.test(message);
}

// Detect if message is a GIF (assuming URL or keyword)
function containsGif(message) {
    // If message contains a .gif extension or 'gif' keyword
    const gifRegex = /\.gif\b|<gif>/i;
    return gifRegex.test(message);
}

// Respond with a similar GIF or emoji
function respondWithGifOrEmoji(message) {
    // Placeholder logic for GIF response
    // In production, you might query a GIF API or have predefined responses
    const gifResponses = [
        '🤔', '😄', '🎉', '😎', '👍'
    ];
    // If original message has emoji, mirror an emoji response
    if (containsEmoji(message)) {
        // Return the first matched emoji or a random one
        const emojiMatch = message.match(/(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/u);
        return emojiMatch ? emojiMatch[0] : gifResponses[Math.floor(Math.random() * gifResponses.length)];
    }
    // If original message has 'gif', return a random placeholder emoji
    return gifResponses[Math.floor(Math.random() * gifResponses.length)];
}

// SelfTune: adjust prompt based on user style/preferences
function selfTunePrompt(prompt, userData) {
    // Example: adjust tone based on user preference
    if (userData.style === 'formal') {
        prompt = 'Please answer formally: ' + prompt;
    } else if (userData.style === 'casual') {
        prompt = 'In a friendly tone: ' + prompt;
    }
    // More complex adaptation logic could go here
    return prompt;
}

// Add an emoji prefix to the response
function addEmojiPrefix(response) {
    const prefixEmojis = ['😊', '👍', '🎉', '🤖', '✨'];
    const emoji = prefixEmojis[Math.floor(Math.random() * prefixEmojis.length)];
    return emoji + ' ' + response;
}

// Filter out phrases that reveal the AI nature
function filterAIPhrases(response) {
    const forbiddenPhrases = [
        'as an AI', 
        'as a language model', 
        'I am an AI',
        'I am an artificial intelligence',
        'as an AI assistant',
        'I\'m just a bot'
    ];
    let filtered = response;
    forbiddenPhrases.forEach(phrase => {
        const regex = new RegExp(phrase, 'gi');
        filtered = filtered.replace(regex, '');
    });
    return filtered;
}

// Main response function
async function aiRespond(userMessage, userData) {
    // If the user message is a GIF or emoji, respond similarly
    if (containsGif(userMessage) || containsEmoji(userMessage)) {
        return respondWithGifOrEmoji(userMessage);
    }

    // Apply self-tuning to user message
    const tunedPrompt = selfTunePrompt(userMessage, userData);

    // Get AI response using cascaded models
    let response;
    try {
        response = await getResponseWithCascade(tunedPrompt, userData);
    } catch (err) {
        console.error('All models failed:', err);
        response = "Вибачте, сталася помилка."; // Error fallback message
    }

    // Filter out any anti-AI phrases
    response = filterAIPhrases(response);

    // Add emoji at start of response
    response = addEmojiPrefix(response);

    return response;
}

// Export the main function (preserve existing exports)
module.exports = {
    aiRespond
};