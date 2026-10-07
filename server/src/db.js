const mongoose = require("mongoose");

// `login` was renamed to `username`. Mongo kept the old unique index.
// A non-sparse unique index treats every missing value as null, so every
// new web user collided on login: null.
const STALE_INDEXES = ["login_1"];

async function dropStaleIndexes() {
    const collection = mongoose.connection.collection("web_users");
    let indexes;
    try {
        indexes = await collection.indexes();
    } catch (error) {
        if (error?.codeName === "NamespaceNotFound") return;
        console.error("[dropStaleIndexes]", error);
        throw error;
    }
    for (const name of STALE_INDEXES) {
        if (!indexes.some((index) => index.name === name)) continue;
        await collection.dropIndex(name);
        console.log("[dropStaleIndexes] dropped", name);
    }
}

async function connect(url) {
    mongoose.set("strictQuery", true);
    await mongoose.connect(url, {
        autoIndex: true,
        serverSelectionTimeoutMS: 30000,
        maxPoolSize: 10,
    });
    await dropStaleIndexes();
    console.log("[connect] MongoDB connected");
}

module.exports = { connect, dropStaleIndexes };
