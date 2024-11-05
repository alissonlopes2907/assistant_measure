const OpenAI = require('openai')
require('dotenv').config()

const openai = new OpenAI({
    apiKey: process.env.API_KEY
})


async function createThread() {
    try {
        const thread =  await openai.beta.threads.create()

        return thread.id
    } catch (error) {
        console.log('Erro ao criar uma nova thread: ', error)
        throw error
    }
}

module.exports = { createThread}