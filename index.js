const express = require('express');
const cors = require('cors');
require('dotenv').config()
const mongoUri = process.env.MONGO_URI;
const dbname = "menu-ordering";
const { connect } = require('./db');
const { ObjectId } = require('mongodb');


let app = express();
app.use(cors());
app.use(express.json());


async function main() {
    try {
        const db = await connect(mongoUri, dbname);
        console.log('Connected to MongoDB');
        // Add your route code here

        app.get("/menu", async (req, res) => {
            try {
                const items = await db.collection("menu").find().project({ _id: 0 }).toArray();
                res.json(items);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch menu" });
            }
        })

        app.get("/menuItem/:id", async (req, res) => {
            try {
                const id = req.params.id;

                // First, fetch the recipe
                const menuItem = await db.collection("menu").findOne(
                    { _id: new ObjectId(id) },
                    { projection: { _id: 0 } }
                );

                if (!menuItem) {
                    return res.status(404).json({ error: "item not found" });
                }

                res.json(menuItem);
            } catch (error) {
                console.error("Error fetching item:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        })

        app.get('/menu/search', async (req, res) => {
            try {
                const { tags, category, ingredients, name } = req.query;
                let query = {};

                if (tags) {
                    query.tags = { $in: tags.split(',').map(t => t.trim()) };
                }

                if (category) {
                    query.category = { $regex: category, $options: 'i' };
                }

                if (ingredients) {
                    query.ingredients = { $all: ingredients.split(',').map(i => new RegExp(i.trim(), 'i')) };
                }

                if (name) {
                    query.name = { $regex: name, $options: 'i' };
                }

                const items = await db.collection('menu').find(query).project({
                    _id: 0,
                    name: 1,
                    category: 1,
                    price: 1,
                    tags: 1,
                    isAvailable: 1
                }).toArray();

                res.json({ items });
            } catch (error) {
                console.error('Error searching menu:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.listen(3000, () => {
            console.log("Server started")
        })

    } catch (error) {
        console.error('Error connecting to MongoDB', error);
    }
}
main();

