require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL;

async function generateSearchParams(query, tags, categories, ingredients) {
    const systemPrompt =
        `You are a search query converter for a hawker stall menu. Convert the customer's natural language query into a structured search format. Here are all the available tags, categories and ingredients:

 Available Tags: ${tags.join(', ')}
 Available Categories: ${categories.join(', ')}
 Available Ingredients: ${ingredients.join(', ')}

 Output: A JSON object with the following fields, ONLY using values from the available lists above and empty arrays
 if no values apply:
 {
  "categories": string[],
  "tags": string[],
  "ingredients": string[]
 }

 - tags: array of strings of matching tags (OR logic - menu item has ANY of them)
 - categories: array of categories (OR logic - menu item is in ANY of them)
 - ingredients: array of strings of ingredients (AND logic - menu item must have ALL of them)

 Rules:
 - only use tags from the available list
 - only use categories from the available list
 - only use ingredients from the available list
 - only include ingredients the customer actually mentions or clearly implies, because every ingredient listed must be in the dish
 - keep all values lowercase, exactly as they appear in the available lists
 - Return ONLY valid JSON, no explanations and no code fences
 - Apply semantic understanding - infer the tags, categories and ingredients from the query. Example:
 - "meat" can mean chicken
 - "something to drink" or "thirsty" means the drink category
 - "rice dish" or "meal" means the main category
 - "vegetables" or "greens" can mean kangkong or the side category
 - "muslim-friendly" means the halal tag
 - "not spicy" or "mild" means the non-spicy tag
 - "popular" or "recommended" means the bestseller tag
 - Infer categories from tags and ingredients
 - Infer tags from categories and ingredients

Example input: "something halal with chicken"
Example output: {"categories":["main"],"tags":["halal"],"ingredients":["chicken"]}

Example input: "i'm thirsty"
Example output: {"categories":["drink"],"tags":[],"ingredients":[]}

Example input: "spicy vegetable side dish"
Example output: {"categories":["side"],"tags":["spicy","vegetarian-option"],"ingredients":[]}

Example input: "your most popular rice dish that isn't spicy"
Example output: {"categories":["main"],"tags":["bestseller","non-spicy"],"ingredients":["rice"]}

Customer's query: ${query}
 `
    const aiResponse = await ai.models.generateContent({
        model: MODEL,
        contents: systemPrompt,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                "type": "object",
                "properties": {
                    "ingredients": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "tags": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    },
                    "categories": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        }
                    }
                },
                "required": [
                    "ingredients",
                    "tags",
                    "categories"
                ]
            }
        }
    })

    const searchParams = JSON.parse(aiResponse.text);
    return searchParams;
}

async function generateMenuItem(menuText, availableCategories, availableTags) {
    const systemPrompt = `You are a menu item parser for a Singapore hawker stall. Convert the stall owner's natural language description of a dish into a structured menu item format.

Existing categories: ${availableCategories.join(', ')}
Existing tags: ${availableTags.join(', ')}

Parse the description and output a JSON object with the following structure:
{
  "name": string,
  "category": string,
  "price": number (in SGD),
  "description": string,
  "tags": array of strings,
  "ingredients": array of strings,
  "isAvailable": boolean
}

Rules:
- Extract the dish name from the text (use proper capitalization)
- Use an existing category if one fits; only create a new category if none of the existing ones fit
- Use existing tags where they fit; you may add new tags for characteristics the existing tags do not cover
- Never create a new category or tag that means the same as an existing one (e.g. do not add "veg" if "vegetarian-option" exists)
- New categories and tags must be short, lowercase, and use hyphens instead of spaces (e.g. "no-pork", "dessert")
- Use the price if stated, otherwise estimate a typical Singapore hawker price
- Write a short, appetising one-sentence description (proper sentence case ending with a period)
- List the main ingredients as simple names only, no amounts (ingredients in lowercase)
- Set isAvailable to false only if the text says the item is sold out or unavailable, otherwise true
- Use proper English grammar and capitalization
- Return ONLY valid JSON, no explanation

Example input: "New dish - hokkien mee, $6. Yellow noodles and bee hoon fried with prawns, squid and egg in prawn stock, served with sambal and lime."

Example output: {
  "name": "Hokkien Mee",
  "category": "main",
  "price": 6,
  "description": "Yellow noodles and bee hoon wok-fried in rich prawn stock with prawns, squid and egg, served with sambal and lime.",
  "tags": ["spicy", "seafood"],
  "ingredients": ["yellow noodles", "bee hoon", "prawns", "squid", "egg", "prawn stock", "sambal", "lime"],
  "isAvailable": true
}

Example input: "chendol $2.50, shaved ice with coconut milk, gula melaka and green jelly"

Example output: {
  "name": "Chendol",
  "category": "dessert",
  "price": 2.5,
  "description": "Shaved ice topped with rich coconut milk, gula melaka syrup and pandan jelly.",
  "tags": ["halal", "vegan", "non-spicy", "cold"],
  "ingredients": ["shaved ice", "coconut milk", "gula melaka", "pandan jelly", "red beans"],
  "isAvailable": true
}`;

    const aiResponse = await ai.models.generateContent({
        model: MODEL,
        contents: systemPrompt + '\n\nMenu item text: ' + menuText,
        config: {
            responseMimeType: "application/json",
            responseJsonSchema: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    category: { type: "string" },
                    price: { type: "number" },
                    description: { type: "string" },
                    tags: {
                        type: "array",
                        items: { type: "string" }
                    },
                    ingredients: {
                        type: "array",
                        items: { type: "string" }
                    },
                    isAvailable: { type: "boolean" }
                },
                required: ["name", "category", "price", "description", "tags", "ingredients", "isAvailable"]
            }
        }
    });

    const menuItem = JSON.parse(aiResponse.text);
    return menuItem;
}

module.exports = {
    ai, MODEL, generateSearchParams, generateMenuItem
}