const OpenAI = require('openai');

async function run() {
    const apiKey = 'AIzaSyAkG6CduQQ8_15655uu9TGgkmDFaJSyTPA'; // User's key
    const baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    const model = 'gemini-2.5-flash';

    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: baseURL,
        timeout: 25000
    });

    const messages = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hii' }
    ];

    try {
        console.log('Sending request to Gemini...');
        const completion = await openai.chat.completions.create({
            model: model,
            messages: messages,
            // Testing WITHOUT response_format first to see raw output
        });

        console.log('Response received:');
        console.log(JSON.stringify(completion, null, 2));

        if (completion.choices && completion.choices.length > 0) {
            console.log('Content:', completion.choices[0].message.content);
        } else {
            console.log('No choices returned.');
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

run();
