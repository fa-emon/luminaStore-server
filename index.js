const express = require('express')
const app = express()
require('dotenv').config()
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.PAYMENT_SECRET_KEY);
const cors = require('cors')
const port = process.env.PORT || 5000
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


// middleware
app.use(cors())
app.use(express.json());


const verifyJWT = (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'unauthorized access' })
    }
    const token = authorization.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ error: true, message: 'unauthorized access' })
        }
        req.decoded = decoded;
        next();
    })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.zdzdyrx.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const clothesCollection = client.db("luminaStore").collection("clothes");
        const orderCollection = client.db("luminaStore").collection("order");
        const userCollection = client.db("luminaStore").collection("user");
        const paymentCollection = client.db("luminaStore").collection("payment");



        // {----------jwt api----------}
        app.post('/jwt', (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
            res.send({ token });
        })

        // It's a middleware checking a user is Admin or not in the database. That's why it's writting in between mongodb.
        //Warning: use verifyJWT before using verifyAdmin.
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await userCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ error: true, message: 'forbidden access.' })
            }
            next();
        }

        // {----------user api----------}
        app.get('/user', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await userCollection.find().toArray();
            res.send(result);
        })

        app.post('/user', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await userCollection.findOne(query)
            if (existingUser) {
                return res.send({ message: 'user already exists' })
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })


        // {----------admin api----------}
        app.get('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if (req.decoded.email != email) {
                res.send({ admin: false })
            }

            const query = { email: email }
            const user = await userCollection.findOne(query);
            const result = { admin: user?.role === 'admin' }
            res.send(result);
        })

        app.patch('/user/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'admin'
                },
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.delete('/user/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await userCollection.deleteOne(query);
            res.send(result);
        })

        // {----------clothes api----------}
        app.get('/clothes', async (req, res) => {
            const result = await clothesCollection.find().toArray();
            res.send(result);
        })

        app.get('/clothes/category/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await clothesCollection.findOne(query);
            res.send(result);
        })

        app.patch('/clothes/category/:id', async (req, res) => {
            const product = req.body;
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    short_description: product.short_description,
                    new_price: product.new_price,
                    old_price: product.old_price,
                    category: product.category,
                    image: product.image,
                }
            }

            const result = await clothesCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        app.post('/clothes', verifyJWT, verifyAdmin, async (req, res) => {
            const product = req.body;
            const result = await clothesCollection.insertOne(product);
            res.send(result);
        })

        app.delete('/clothes/:id', verifyJWT, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await clothesCollection.deleteOne(query);
            res.send(result);
        })

        // {----------order api----------}
        app.get('/order', verifyJWT, async (req, res) => {
            const email = req.query.email;
            if (!email) {
                res.send([]);
            }

            const decodedEmail = req.decoded.email;
            if (email != decodedEmail) {
                return res.status(403).send({ error: true, message: 'forbidden access' })
            }

            const query = { email: email };
            const result = await orderCollection.find(query).toArray();
            res.send(result);
        })

        // app.post('/order', async (req, res) => {
        //     const item = req.body;
        //     const result = await orderCollection.insertOne(item);
        //     res.send(result);
        // })

        app.post('/order', async (req, res) => {
            const item = req.body;
            const existingOrder = await orderCollection.findOne({ product_id: item.product_id, email: item.email });

            if (existingOrder) {
                // If the order already exists, update its quantity
                const updatedQuantity = existingOrder.quantity + 1;
                const result = await orderCollection.updateOne(
                    { _id: existingOrder._id },
                    { $set: { quantity: updatedQuantity } }
                );
                res.send(result);
            } else {
                // If the order does not exist, insert a new order
                const result = await orderCollection.insertOne(item);
                res.send(result);
            }
        });


        app.delete('/order/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await orderCollection.deleteOne(query);
            res.send(result);
        })

        // {---------Payment api---------}

        //payment intent
        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: [
                    "card"
                ],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        app.get('/payment/:email', verifyJWT, async (req, res) => {
            const email = req.params.email;
            if(req.decoded.email != email){
                return res.status(403).send({message: 'forbidden access'});
            }

            const query = { email: email }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/payment', verifyJWT, async (req, res) => {
            const payment = req.body;
            const insertResult = await paymentCollection.insertOne(payment);

            const query = { _id: { $in: payment.orderProducts.map(id => new ObjectId(id)) } }
            const deleteResult = await orderCollection.deleteMany(query);


            res.send({ insertResult, deleteResult });
        })

        app.get('/admin-statistics', verifyJWT, verifyAdmin, async (req, res) => {
            const user = await userCollection.estimatedDocumentCount();
            const products = await clothesCollection.estimatedDocumentCount();
            const orders = await paymentCollection.estimatedDocumentCount();
            // const payments = await paymentCollection.find().toArray();
            // const revenue = payments.reduce((sum, item) => sum + item.price, 0)
            const result = await paymentCollection.aggregate([
                {
                    $group:{
                        _id: null,
                        totalRevenue: {
                            $sum: '$price'
                        }
                    }
                }
            ]).toArray();

            const revenue = result.length > 0 ? result[0].totalRevenue : 0

            res.send({
                user,
                products,
                orders,
                revenue
            });
        })

        // using aggregate pipeline
        app.get('/order-statistics', async(req, res) => {
            const result = await paymentCollection.aggregate([
                {
                    $unwind: '$productsId'
                },
                {
                    $lookup: {
                        from: 'clothes',
                        localField: 'productsId',
                        foreignField: 'category_id',
                        as: 'orderProducts'
                    }
                },
                {
                    $unwind: '$orderProducts'
                },
                {
                    $group: {
                        _id: '$orderProducts.category',
                        quantity: {$sum: 1},
                        totalRevenue: {$sum: '$orderProducts.new_price'}
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: '$_id',
                        quantity: '$quantity',
                        revenue: '$totalRevenue'
                    }
                }
            ]).toArray();

            res.send(result);
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.log);



app.get('/', (req, res) => {
    res.send('Hello luminaStore!')
})

app.listen(port, () => {
    console.log(`your server is running on port ${port}`)
})