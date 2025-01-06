const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_app', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// Define Schemas
const MessageSchema = new mongoose.Schema({
    username: String,
    text: String,
    timestamp: { type: Date, default: Date.now },
    userAgent: String,
    ipAddress: String
});

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true },
    email: String,
    joinDate: { type: Date, default: Date.now },
    lastActive: Date,
    timeZone: String,
    deviceInfo: {
        browser: String,
        os: String,
        device: String
    },
    analytics: {
        totalMessages: { type: Number, default: 0 },
        averageMessageLength: { type: Number, default: 0 },
        activeHours: [Number],
        loginTimes: [Date]
    }
});

const Message = mongoose.model('Message', MessageSchema);
const User = mongoose.model('User', UserSchema);

// Express setup
const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, 'public')));

// Socket.IO connection handling
io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);
    let currentUser = null;

    // Load chat history when user joins
    socket.on('join', async (userData) => {
        const { username, timeZone, deviceInfo } = userData;

        // Create or update user
        currentUser = await User.findOneAndUpdate(
            { username },
            {
                timeZone,
                deviceInfo,
                lastActive: new Date(),
                $push: { loginTimes: new Date() }
            },
            { upsert: true, new: true }
        );

        // Send last 50 messages to user
        const chatHistory = await Message.find()
            .sort({ timestamp: -1 })
            .limit(50)
            .lean();

        socket.emit('chatHistory', chatHistory.reverse());

        // Announce user join
        io.emit('message', {
            username: 'System',
            text: `${username} has joined the chat`,
            timestamp: new Date()
        });
    });

    // Handle messages
    socket.on('message', async (messageData) => {
        if (!currentUser) return;

        // Create message document
        const message = new Message({
            username: currentUser.username,
            text: messageData.text,
            userAgent: messageData.userAgent,
            ipAddress: socket.handshake.address
        });

        await message.save();

        // Update user analytics
        await User.findByIdAndUpdate(currentUser._id, {
            $inc: { 'analytics.totalMessages': 1 },
            lastActive: new Date(),
            $set: {
                'analytics.averageMessageLength':
                    (currentUser.analytics.averageMessageLength * currentUser.analytics.totalMessages +
                     messageData.text.length) / (currentUser.analytics.totalMessages + 1)
            }
        });

        // Broadcast message to all clients
        io.emit('message', {
            username: currentUser.username,
            text: messageData.text,
            timestamp: message.timestamp
        });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
        if (currentUser) {
            await User.findByIdAndUpdate(currentUser._id, {
                lastActive: new Date()
            });

            io.emit('message', {
                username: 'System',
                text: `${currentUser.username} has left the chat`,
                timestamp: new Date()
            });
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});