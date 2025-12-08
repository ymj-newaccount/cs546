import mongoCollections from "../config/mongoCollections.js";
const users = mongoCollections.users;
import { ObjectId } from "mongodb";
// Library for password hashing (security)
import bcrypt from "bcrypt";
const saltRounds = 12;

// Creates a new user
export async function createUser(username, email, password) {
    // Validate inputs 
    if (!username || !email || !password) throw "All fields are required";
    if (typeof username !== "string" || 
        typeof email !== "string" || 
        typeof password !== "string") {
        throw "All inputs must be strings";
    }

    const usersCollection = await users();
    // If username/email already exists, stop 
    const existingUser = await usersCollection.findOne({ $or: [{ username }, { email }] });
    if (existingUser) throw "Username or email already exists";

    // Hashing to protect user security
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const newUser = {
        username,
        email,
        hashedPassword,
        bookmarks: [],
        alerts: [],
        createdAt: new Date(),
    };

    const insertInfo = await usersCollection.insertOne(newUser);
    if (!insertInfo.acknowledged) throw "Could not add user";

    return await getUserById(insertInfo.insertedId.toString());
}


// Verify user login
export async function checkUser(username, password) {
    if (!username || !password) throw "You must provide a username and a password";
    const usersCollection = await users();

    const user = await usersCollection.findOne({ username });
    if (!user) throw "Either the username or password is invalid";

    const passwordMatch = await bcrypt.compare(password, user.hashedPassword);
    if (!passwordMatch) throw "Either the username or password is invalid";

    return user;
}


// Get user by their id
export async function getUserById(id) {
    if (!id) throw "You must provide an id";
    const usersCollection = await users();

    const user = await usersCollection.findOne({ _id: new ObjectId(id) });
    if (!user) throw "User not found";

    user._id = user._id.toString();
    delete user.hashedPassword;
    return user;
}


//System for users to create station bookmarks
// Function that allows a user to add a station to their bookmarks
export async function addBookmark(userId, stationId) {
    if (!userId || !stationId) throw "Must provide userId and stationId";
    const usersCollection = await users();

    const updateInfo = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        // Prevents duplicates
        { $addToSet: { bookmarks: stationId } }
    );
    if (updateInfo.modifiedCount === 0) throw "Could not add bookmark";
    return await getUserById(userId);
}
// Function that allows a user to remove a station from their bookmarks
export async function removeBookmark(userId, stationId) {
    if (!userId || !stationId) throw "Must provide userId and stationId";
    const usersCollection = await users();

    const updateInfo = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        // Removes elements with this id
        { $pull: { bookmarks: stationId } }
    );
    if (updateInfo.modifiedCount === 0) throw "Could not remove bookmark";
    return await getUserById(userId);
}


// Function for a user to set alerts
export async function setAlerts(userId, alertsArray) {
    if (!userId || !Array.isArray(alertsArray)) throw "Must provide userId and an array of alerts";
    const usersCollection = await users();

    const updateInfo = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { alerts: alertsArray } }
    );
    if (updateInfo.modifiedCount === 0) throw "Could not update alerts";
    return await getUserById(userId);
}
