require('dotenv').config()

const { Client } = require('pg')

const {createThread} = require('./threads')


const dbClient = new Client({
     connectionString:process.env.DATABASE_URL,
     ssl:{
        rejectUnauthorized: false,
     }

})

dbClient.connect()


async function saveOrFetchThread(whatsappId) {
    try {

        const querySelect = 'SELECT thread_id FROM threads WHERE whatsapp_id = $1 '
        const result = await dbClient.query(querySelect, [whatsappId])

        if(result.rows.length > 0 && result.rows[0].thread_id) {
            const existingThreadId = result.rows[0].thread_id
            console.log(`O usuário ${whatsappId} já tem um threadId: ${existingThreadId}`)
            return existingThreadId
        } else {
            const newThreadId = await createThread()

            const queryInsert = `
             INSERT INTO threads (whatsapp_id, thread_id)
             VALUES ($1, $2)
             ON CONFLICT (whatsapp_id) DO UPDATE SET thread_id = EXCLUDED.thread_id
             RETURNING thread_id
            `

            const insertResult = await dbClient.query(queryInsert, [whatsappId, newThreadId])
            console.log(`NOVO threadId salvo para o usuário ${whatsappId}: ${newThreadId}`)
          
            return insertResult.rows[0].thread_id
        }
    } catch (error) {
        console.log('Erro ao salvar ou buscar thread id: ', error)
    }

}

async function getChannelIdByWhatsappId(whatsappId) {
    const query = 'SELECT channel_id FROM channels WHERE whatsapp_id = $1'
    const result = await dbClient.query(query, [whatsappId])
    return result.rows[0]?.channel_id || null
}

async function saveChannelId(whatsappId, channelId) {
    const query = `
       INSERT INTO channels (whatsapp_id, channel_id)
       VALUES ($1, $2)
       ON CONFLICT (whatsapp_id) DO UPDATE SET channel_id = $2
    `
    await dbClient.query(query, [whatsappId, channelId])
}

module.exports ={ saveOrFetchThread,
    getChannelIdByWhatsappId,
    saveChannelId
}