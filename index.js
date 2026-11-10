const express = require('express');
const cors = require('cors');
require('dotenv').config()
const mongoUri = process.env.MONGO_URI;
const dbname = "menu-ordering";
const { connect } = require('./db');
const { ObjectId } = require('mongodb');
const { generateSearchParams, generateMenuItem } = require("./gemini")
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const generateAccessToken = (id, email) => {
    return jwt.sign({
        'user_id': id,
        'email': email
    }, process.env.TOKEN_SECRET, {
        expiresIn: "1h"
    });
}

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(403);
    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

let app = express();
app.use(cors());
app.use(express.json());


async function main() {
    try {
        const db = await connect(mongoUri, dbname);
        console.log('Connected to MongoDB');

        app.get("/menu", async (req, res) => {
            try {
                const items = await db.collection("menu").find().project().toArray();
                res.json(items);
            } catch (error) {
                console.error(error);
                res.status(500).json({ error: "Failed to fetch menu" });
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

        app.get('/menu/ai-search', async (req, res) => {
            try {
                const { q } = req.query;

                if (!q) {
                    return res.status(400).json({ error: 'Search query is required' });
                }

                const tags = await db.collection('menu').distinct('tags');
                const categories = await db.collection('menu').distinct('category');
                const ingredients = await db.collection('menu').distinct('ingredients');

                const searchParams = await generateSearchParams(q, tags, categories, ingredients);

                let query = {};

                if (searchParams.categories.length > 0) {
                    query.category = { $in: searchParams.categories };
                }

                if (searchParams.tags.length > 0) {
                    query.tags = { $in: searchParams.tags };
                }

                if (searchParams.ingredients.length > 0) {
                    query.ingredients = { $all: searchParams.ingredients };
                }

                const items = await db.collection('menu').find(query).project({
                    name: 1,
                    category: 1,
                    price: 1,
                    tags: 1,
                    isAvailable: 1
                }).toArray();

                res.json({ searchParams, items });
            } catch (error) {
                console.error('Error with AI search:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get("/menu/:id", async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).json({ error: "Invalid menu item id" });
                }

                const menuItem = await db.collection("menu").findOne(
                    { _id: new ObjectId(id) }
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

        app.post('/menu', verifyToken, async (req, res) => {
            try {
                const { name, category, price, description, tags, ingredients, isAvailable } = req.body;

                if (!name || !category || price === undefined || !ingredients || !tags) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                if (typeof price !== 'number' || price < 0) {
                    return res.status(400).json({ error: 'Price must be a positive number' });
                }

                if (!Array.isArray(tags) || !Array.isArray(ingredients)) {
                    return res.status(400).json({ error: 'Tags and ingredients must be arrays' });
                }

                const existing = await db.collection('menu').findOne({ name: name });
                if (existing) {
                    return res.status(409).json({ error: 'Menu item already exists' });
                }

                const newMenuItem = {
                    name,
                    category,
                    price,
                    description: description || '',
                    tags,
                    ingredients,
                    isAvailable: isAvailable !== undefined ? isAvailable : true
                };

                const result = await db.collection('menu').insertOne(newMenuItem);

                res.status(201).json({
                    message: 'Menu item created successfully',
                    menuItemId: result.insertedId
                });
            } catch (error) {
                console.error('Error creating menu item:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.post('/menu/ai-create', verifyToken, async (req, res) => {
            try {
                const { text } = req.body;

                if (!text) {
                    return res.status(400).json({ error: 'Menu item text is required' });
                }

                const categories = await db.collection('menu').distinct('category');
                const tags = await db.collection('menu').distinct('tags');

                const newMenuItem = await generateMenuItem(text, categories, tags);

                if (!categories.includes(newMenuItem.category)) {
                    return res.status(400).json({ error: 'AI could not match a valid category' });
                }

                const existing = await db.collection('menu').findOne({ name: newMenuItem.name });
                if (existing) {
                    return res.status(409).json({ error: 'Menu item already exists' });
                }

                const result = await db.collection('menu').insertOne(newMenuItem);

                res.status(201).json({
                    message: 'Menu item created successfully',
                    menuItemId: result.insertedId,
                    menuItem: newMenuItem
                });
            } catch (error) {
                console.error('Error creating menu item with AI:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.put('/menu/:id', verifyToken, async (req, res) => {
            try {
                const menuItemId = req.params.id;
                const { name, category, price, description, tags, ingredients, isAvailable } = req.body;

                if (!ObjectId.isValid(menuItemId)) {
                    return res.status(400).json({ error: 'Invalid menu item id' });
                }

                if (!name || !category || price === undefined || !ingredients || !tags) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                if (typeof price !== 'number' || price < 0) {
                    return res.status(400).json({ error: 'Price must be a positive number' });
                }

                if (!Array.isArray(tags) || !Array.isArray(ingredients)) {
                    return res.status(400).json({ error: 'Tags and ingredients must be arrays' });
                }

                const duplicate = await db.collection('menu').findOne({
                    name: name,
                    _id: { $ne: new ObjectId(menuItemId) }
                });
                if (duplicate) {
                    return res.status(409).json({ error: 'Another menu item already has this name' });
                }

                const updatedMenuItem = {
                    name,
                    category,
                    price,
                    description: description || '',
                    tags,
                    ingredients,
                    isAvailable: isAvailable !== undefined ? isAvailable : true
                };

                const result = await db.collection('menu').replaceOne(
                    { _id: new ObjectId(menuItemId) },
                    updatedMenuItem
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Menu item not found' });
                }

                res.json({
                    message: 'Menu item updated successfully'
                });
            } catch (error) {
                console.error('Error updating menu item:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.delete('/menu/:id', verifyToken, async (req, res) => {
            try {
                const menuItemId = req.params.id;

                if (!ObjectId.isValid(menuItemId)) {
                    return res.status(400).json({ error: 'Invalid menu item id' });
                }

                const result = await db.collection('menu').deleteOne({ _id: new ObjectId(menuItemId) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: 'Menu item not found' });
                }

                res.json({ message: 'Menu item deleted successfully' });
            } catch (error) {
                console.error('Error deleting menu item:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get('/orders', verifyToken, async (req, res) => {
            try {
                const orders = await db.collection('orders').find().toArray();
                res.json(orders);
            } catch (error) {
                console.error('Error fetching orders:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.get('/orders/:id', async (req, res) => {
            try {
                const orderId = req.params.id;

                if (!ObjectId.isValid(orderId)) {
                    return res.status(400).json({ error: 'Invalid order id' });
                }

                const order = await db.collection('orders').findOne({ _id: new ObjectId(orderId) });

                if (!order) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                res.json(order);
            } catch (error) {
                console.error('Error fetching order:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.post('/orders', async (req, res) => {
            try {
                const { customerName, items, notes } = req.body;

                if (!customerName || !items) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                if (!Array.isArray(items) || items.length === 0) {
                    return res.status(400).json({ error: 'Items must be a non-empty array' });
                }

                for (const item of items) {
                    if (!ObjectId.isValid(item.menuItemId)) {
                        return res.status(400).json({ error: `Invalid menu item id: ${item.menuItemId}` });
                    }
                    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
                        return res.status(400).json({ error: 'Quantity must be a whole number of at least 1' });
                    }
                }

                const menuIds = items.map(item => new ObjectId(item.menuItemId));
                const menuDocs = await db.collection('menu').find({ _id: { $in: menuIds } }).toArray();

                const orderItems = [];
                for (const item of items) {
                    const menuDoc = menuDocs.find(doc => doc._id.equals(item.menuItemId));

                    if (!menuDoc) {
                        return res.status(400).json({ error: `Menu item not found: ${item.menuItemId}` });
                    }
                    if (!menuDoc.isAvailable) {
                        return res.status(400).json({ error: `${menuDoc.name} is not available` });
                    }

                    orderItems.push({
                        menuItemId: menuDoc._id,
                        name: menuDoc.name,
                        price: menuDoc.price,
                        quantity: item.quantity
                    });
                }

                const totalPrice = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

                const newOrder = {
                    customerName,
                    items: orderItems,
                    totalPrice: Math.round(totalPrice * 100) / 100,
                    status: 'pending',
                    notes: notes || ''
                };

                const result = await db.collection('orders').insertOne(newOrder);

                res.status(201).json({
                    message: 'Order created successfully',
                    orderId: result.insertedId,
                    totalPrice: newOrder.totalPrice
                });
            } catch (error) {
                console.error('Error creating order:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.patch('/orders/:id/status', verifyToken, async (req, res) => {
            try {
                const orderId = req.params.id;
                const { status } = req.body;
                const validStatuses = ['pending', 'preparing', 'ready', 'collected', 'cancelled'];

                if (!ObjectId.isValid(orderId)) {
                    return res.status(400).json({ error: 'Invalid order id' });
                }

                if (!validStatuses.includes(status)) {
                    return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
                }

                const result = await db.collection('orders').updateOne(
                    { _id: new ObjectId(orderId) },
                    { $set: { status: status } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                res.json({ message: `Order status updated to ${status}` });
            } catch (error) {
                console.error('Error updating order status:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.delete('/orders/:id', verifyToken, async (req, res) => {
            try {
                const orderId = req.params.id;

                if (!ObjectId.isValid(orderId)) {
                    return res.status(400).json({ error: 'Invalid order id' });
                }

                const result = await db.collection('orders').deleteOne({ _id: new ObjectId(orderId) });

                if (result.deletedCount === 0) {
                    return res.status(404).json({ error: 'Order not found' });
                }

                res.json({ message: 'Order deleted successfully' });
            } catch (error) {
                console.error('Error deleting order:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.post('/users', async function (req, res) {
            try {
                const { email, password } = req.body;

                if (!email || !password) {
                    return res.status(400).json({ error: 'Email and password are required' });
                }

                if (!email.includes('@')) {
                    return res.status(400).json({ error: 'Email must contain @' });
                }

                const existingUser = await db.collection('users').findOne({ email: email });
                if (existingUser) {
                    return res.status(409).json({ error: 'Email is already registered' });
                }

                const result = await db.collection('users').insertOne({
                    email: email,
                    password: await bcrypt.hash(password, 12)
                });

                res.status(201).json({
                    message: 'New user account created',
                    userId: result.insertedId
                });
            } catch (error) {
                console.error('Error creating user:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        app.post('/login', async (req, res) => {
            try {
                const { email, password } = req.body;

                if (!email || !password) {
                    return res.status(400).json({ error: 'Email and password are required' });
                }

                const user = await db.collection('users').findOne({ email: email });
                if (!user) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                const isPasswordValid = await bcrypt.compare(password, user.password);
                if (!isPasswordValid) {
                    return res.status(401).json({ error: 'Invalid email or password' });
                }

                const accessToken = generateAccessToken(user._id, user.email);

                res.json({
                    message: 'Login successful',
                    accessToken: accessToken
                });
            } catch (error) {
                console.error('Error logging in:', error);
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

