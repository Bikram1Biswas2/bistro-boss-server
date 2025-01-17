const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB URI and Client Setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.znhzfas.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Middleware to Verify Token
const verifyToken = (req, res, next) => {
  console.log("Inside verifyToken middleware", req.headers.authorization);

  if (!req.headers.authorization) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
        console.error("Token verification error:", err.message);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

async function run() {
  try {
    // Connect to MongoDB
    await client.connect();

    const userCollection = client.db("bistroRestroDB").collection("users");
    const menuCollection = client.db("bistroRestroDB").collection("menu");
    const reviewCollection = client.db("bistroRestroDB").collection("reviews");
    const cartCollection = client.db("bistroRestroDB").collection("carts");
    const paymentCollection = client.db("bistroRestroDB").collection("payments");

    // use verify admin after verify token
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // JWT Endpoint
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10h",
      });
      res.send({ token });
    });

    // Admin Check Endpoint
    app.get("/users/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);

      const isAdmin = user?.role === "admin";
      res.send({ admin: isAdmin });
    });

    // User-Related Endpoints
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await userCollection.find().toArray();
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.patch(
      "/users/admin/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { role: "admin" } };

        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userCollection.deleteOne(query);
      res.send(result);
    });

    // Menu-Related Endpoints
    app.get("/menu", async (req, res) => {
      const result = await menuCollection.find().toArray();
      res.send(result);
    });

    app.post('/menu',verifyToken,verifyAdmin,async(req,res)=>{
        const item = req.body;
        const result = await menuCollection.insertOne(item)
        res.send(result)
    })

    // get a specific item
    app.get('/menu/:id',async(req,res)=>{
        const id = req.params.id 
        const query = {_id:id}
        const result= await menuCollection.findOne(query)
        res.send(result)
    })

    app.patch('/menu/:id',async(req,res)=>{
        const item = req.body 
        const id = req.params.id 
        const filter = {_id:id}
        const updatedDoc = {
            $set:{
                name:item.name,
                category:item.category,
                price: item.price,
                recipe:item.recipe,
                image: item.image 
            }
        }
        const result = await menuCollection.updateOne(filter,updatedDoc)
        res.send(result)
    })

    app.delete('/menu/:id',verifyToken,verifyAdmin,async(req,res)=>{
        const id = req.params.id;
        const query = {_id: id}
        const result = await menuCollection.deleteOne(query)
        res.send(result)
    })

    // Review-Related Endpoints
    app.get("/reviews", async (req, res) => {
      const result = await reviewCollection.find().toArray();
      res.send(result);
    });

    // Cart-Related Endpoints
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/carts", async (req, res) => {
      const cartItem = req.body;
      const result = await cartCollection.insertOne(cartItem);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(query);
      res.send(result);
    });

    // payment intent
    app.post('/create-payment-intent',async(req,res)=>{
        const {price}= req.body;
        const amount = parseInt(price*100)
        const paymentIntent = await stripe.paymentIntents.create({
            amount:amount,
            currency: 'usd',
            payment_method_types: ['card']
        })
        res.send({
            clientSecret: paymentIntent.client_secret,
        })
    })

    // payment history
    app.get('/payments/:email',verifyToken,async(req,res)=>{
        const email = req.params.email 
        if(req.params.email !== req.decoded.email){
            return res.status(403).send({message: 'forbidden access'})
        }
        const query = {email: email}
        const result = await paymentCollection.find(query).toArray()
        res.send(result)
    })

    // save payment to db
    app.post('/payments',async(req,res)=>{
        const payment = req.body 
        const paymentResult = await paymentCollection.insertOne(payment)

        // carefully delete each item from the cart
        console.log('payment.info',payment);
        const query = {_id: {
            $in: payment.cartIds.map(id=>new ObjectId(id))
        }}
        const deleteResult = await cartCollection.deleteMany(query)
        res.send({paymentResult,deleteResult})
    })

    // stats or analytics
    app.get('/admin-stats',async(req,res)=>{
        const users = await userCollection.estimatedDocumentCount()
        const menuItem = await menuCollection.estimatedDocumentCount()
        const orders = await paymentCollection.estimatedDocumentCount()

        // this is not the best way
        // const payments = await paymentCollection.find().toArray()
        // const revenue = payments.reduce((total, payment)=>total + payment.price, 0)

        const result = await paymentCollection.aggregate([
            {
                $group:{
                    _id:null,
                    totalRevenue:{
                        $sum: '$price'
                    }
                }
            }
        ]).toArray()

        const revenue = result.length>0 ? result[0].totalRevenue: 0

        res.send({
            users,
            menuItem,
            orders,
            revenue
        })
    })

    // using aggregate pipeline
    app.get('/order-stats',async(req,res)=>{
        const result = await paymentCollection.aggregate([
         {
            $unwind: '$menuItemIds'
         },
         {
            $lookup:{
                from:'menu',
                localField:'menuItemIds',
                foreignField: '_id',
                as: 'menuItems'
            }
         },
         {
            $unwind: '$menuItems'
         },
         {
            $group: {
                _id: 'menuItems.category',
                quantity:{$sum: 1},
                revenue: {$sum: '$menuItems.price'}
            }
         }
        ]).toArray()
        res.send(result)
    })

    // MongoDB Connection Test
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. Successfully connected to MongoDB!");
  } finally {
    // Ensure the client will close when the app stops
    // Uncomment the following line in production
    // await client.close();
  }
}
run().catch(console.dir);

// Default Route
app.get("/", (req, res) => {
  res.send("Bistro Boss is sitting");
});

// Start the Server
app.listen(port, () => {
  console.log(`Bistro Boss is running on port ${port}`);
});
