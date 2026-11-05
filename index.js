const express = require('express');
const cors = require('cors');
require('dotenv').config()
const mongoUri = process.env.MONGO_URI;
const dbname = "menu-ordering";
const { connect } = require('./db');


let app = express();
app.use(cors());
app.use(express.json());


async function main() {
    try {
        const db = await connect(mongoUri, dbname);
        console.log('Connected to MongoDB');
        // Add your route code here

        app.get("/menu")

        app.listen(3000, () => {
            console.log("Server started")
        })

    } catch (error) {
        console.error('Error connecting to MongoDB', error);
    }
}
main();

