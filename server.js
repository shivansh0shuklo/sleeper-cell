// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'finity.db');

// Security Middleware
app.use(helmet());

// Enable CORS for all routes (Fix for potential CORS issues)
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Allow all origins (for development)
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use(express.json());

// Serve Frontend (Serves static files like index.html, CSS, JS from the root directory)
app.use(express.static(path.join(__dirname)));

// Initialize Database
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to SQLite database.');
        // Create tables if they don't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                email TEXT DEFAULT '',
                phone TEXT NOT NULL,
                gender TEXT DEFAULT '',
                profile_photo TEXT DEFAULT '',
                balance REAL DEFAULT 100000.00
            )
        `, (err) => {
            if (err) {
                console.error('Error creating users table:', err.message);
                return;
            }
            console.log('Users table created or already exists.');

            db.run(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id TEXT PRIMARY KEY,
                    from_user_id TEXT NOT NULL,
                    to_user_id TEXT NOT NULL,
                    amount REAL NOT NULL,
                    description TEXT,
                    category TEXT DEFAULT 'other',
                    date TEXT DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (from_user_id) REFERENCES users(id),
                    FOREIGN KEY (to_user_id) REFERENCES users(id)
                )
            `, (err) => {
                if (err) {
                    console.error('Error creating transactions table:', err.message);
                    return;
                }
                console.log('Transactions table created or already exists.');

                // Now, after tables are created, check for default user
                db.get("SELECT id FROM users LIMIT 1", [], (err, row) => {
                    if (err) {
                        console.error('Error checking for default user:', err.message);
                    } else if (!row) {
                         const defaultUsername = 'aftermeth';
                         const defaultPassword = 'password123'; // In a real app, use a secure default or force registration
                         const defaultPhone = '+917307270732'; // Cleaned format
                         const defaultId = 'USER000001';

                         bcrypt.hash(defaultPassword, 10, (err, hashedPassword) => {
                             if (err) {
                                 console.error('Error hashing default password:', err.message);
                                 return;
                             }
                             db.run(
                                 `INSERT INTO users (id, username, password_hash, phone) VALUES (?, ?, ?, ?)`,
                                 [defaultId, defaultUsername, hashedPassword, defaultPhone],
                                 (err) => {
                                     if (err) {
                                         console.error('Error creating default user:', err.message);
                                     } else {
                                         console.log('Default user created.');
                                     }
                                 }
                             );
                         });
                    }
                });
            });
        });
    }
});

// Helper function to generate IDs
function generateId(prefix, length = 6) {
    const randomNum = Math.floor(Math.random() * Math.pow(10, length)).toString().padStart(length, '0');
    return `${prefix}${randomNum}`;
}

// API Routes

// 1. User Registration
app.post('/api/register', async (req, res) => {
    const { username, password, phone } = req.body;

    // Basic validation
    if (!username || !password || !phone) {
        return res.status(400).json({ error: 'Username, password, and phone are required.' });
    }

    // In a real app, validate phone format, password strength, etc.
    // Also, implement real OTP verification here using an SMS service.

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = generateId('USER');

        // Use transaction to ensure data consistency
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');

            const insertUser = db.prepare('INSERT INTO users (id, username, password_hash, phone) VALUES (?, ?, ?, ?)');
            insertUser.run([userId, username, hashedPassword, phone], function(err) {
                if (err) {
                    if (err.code === 'SQLITE_CONSTRAINT') {
                        db.run('ROLLBACK');
                        insertUser.finalize();
                        return res.status(409).json({ error: 'Username or phone already exists.' });
                    }
                    db.run('ROLLBACK');
                    insertUser.finalize();
                    console.error('DB Error during registration:', err.message);
                    return res.status(500).json({ error: 'Registration failed due to a server error.' });
                }

                // User created successfully
                db.run('COMMIT');
                insertUser.finalize();
                res.status(201).json({ message: 'User registered successfully.', userId: userId });
            });
        });
    } catch (err) {
        console.error('Error hashing password:', err.message);
        res.status(500).json({ error: 'Registration failed due to a server error.' });
    }
});

// 2. User Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    db.get('SELECT id, username, password_hash, balance FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            console.error('DB Error during login:', err.message);
            return res.status(500).json({ error: 'Login failed due to a server error.' });
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        try {
            const isMatch = await bcrypt.compare(password, user.password_hash);
            if (isMatch) {
                // Return user details (excluding sensitive data like password_hash)
                res.json({ id: user.id, username: user.username, balance: user.balance });
            } else {
                res.status(401).json({ error: 'Invalid username or password.' });
            }
        } catch (err) {
            console.error('Error comparing passwords:', err.message);
            res.status(500).json({ error: 'Login failed due to a server error.' });
        }
    });
});

// 3. Get User Profile
app.get('/api/profile/:userId', (req, res) => {
    const userId = req.params.userId;

    db.get(`
        SELECT id, username, email, phone, gender, profile_photo, balance
        FROM users WHERE id = ?
    `, [userId], (err, user) => {
        if (err) {
            console.error('DB Error fetching profile:', err.message);
            return res.status(500).json({ error: 'Failed to fetch profile.' });
        }
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.json(user);
    });
});

// 4. Update User Profile
app.put('/api/profile/:userId', (req, res) => {
    const userId = req.params.userId;
    const { email, phone, gender, profilePhoto } = req.body; // Include other fields as needed

    // Basic validation
    if (!email && !phone && !gender && !profilePhoto) {
        return res.status(400).json({ error: 'At least one field to update is required.' });
    }

    // In a real app, validate email, phone format, etc.

    const updates = [];
    const params = [];

    if (email !== undefined) {
        updates.push('email = ?');
        params.push(email);
    }
    if (phone !== undefined) {
        updates.push('phone = ?');
        params.push(phone);
    }
    if (gender !== undefined) {
        updates.push('gender = ?');
        params.push(gender);
    }
    if (profilePhoto !== undefined) {
        updates.push('profile_photo = ?');
        params.push(profilePhoto);
    }
    params.push(userId); // Add userId for WHERE clause

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;

    db.run(sql, params, function(err) {
        if (err) {
            console.error('DB Error updating profile:', err.message);
            return res.status(500).json({ error: 'Failed to update profile.' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'User not found.' });
        }
        res.json({ message: 'Profile updated successfully.' });
    });
});

// 5. Get All Users (for Friends List)
app.get('/api/users', (req, res) => {
    // Exclude sensitive data like password_hash
    db.all('SELECT id, username, balance FROM users', [], (err, users) => {
        if (err) {
            console.error('DB Error fetching users:', err.message);
            return res.status(500).json({ error: 'Failed to fetch users.' });
        }
        res.json(users);
    });
});

// 6. Get User Transactions
app.get('/api/transactions/:userId', (req, res) => {
    const userId = req.params.userId;

    // Get transactions where the user is either sender or receiver
    const sql = `
        SELECT id, from_user_id, to_user_id, amount, description, category, date
        FROM transactions
        WHERE from_user_id = ? OR to_user_id = ?
        ORDER BY date DESC
        LIMIT 20 -- Limit for performance, adjust as needed
    `;

    db.all(sql, [userId, userId], (err, transactions) => {
        if (err) {
            console.error('DB Error fetching transactions:', err.message);
            return res.status(500).json({ error: 'Failed to fetch transactions.' });
        }
        res.json(transactions);
    });
});

// 7. Process Payment/Send Money
app.post('/api/payment', async (req, res) => {
    const { fromUserId, toUserId, amount, description, category } = req.body;

    // Validation
    if (!fromUserId || !toUserId || typeof amount !== 'number' || amount <= 0 || !category) {
        return res.status(400).json({ error: 'Valid fromUserId, toUserId, amount (> 0), and category are required.' });
    }

    // Check if sender and recipient are different
    if (fromUserId === toUserId) {
        return res.status(400).json({ error: 'Cannot send money to yourself.' });
    }

    // Use database transaction for atomicity
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Check sender balance
        db.get('SELECT balance FROM users WHERE id = ?', [fromUserId], (err, sender) => {
            if (err) {
                db.run('ROLLBACK');
                console.error('DB Error checking balance:', err.message);
                return res.status(500).json({ error: 'Payment failed due to a server error.' });
            }
            if (!sender) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Sender user not found.' });
            }
            if (sender.balance < amount) {
                db.run('ROLLBACK');
                return res.status(400).json({ error: 'Insufficient balance.' });
            }

            // Check if recipient exists
            db.get('SELECT id FROM users WHERE id = ?', [toUserId], (err, recipient) => {
                if (err) {
                    db.run('ROLLBACK');
                    console.error('DB Error checking recipient:', err.message);
                    return res.status(500).json({ error: 'Payment failed due to a server error.' });
                }
                if (!recipient) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ error: 'Recipient user not found.' });
                }

                // Update balances
                const updateSender = db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?');
                updateSender.run([amount, fromUserId], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        updateSender.finalize();
                        console.error('DB Error updating sender balance:', err.message);
                        return res.status(500).json({ error: 'Payment failed due to a server error.' });
                    }

                    const updateRecipient = db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?');
                    updateRecipient.run([amount, toUserId], function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            updateSender.finalize();
                            updateRecipient.finalize();
                            console.error('DB Error updating recipient balance:', err.message);
                            return res.status(500).json({ error: 'Payment failed due to a server error.' });
                        }

                        // Insert transaction record
                        const transactionId = generateId('TXN');
                        const insertTransaction = db.prepare(`
                            INSERT INTO transactions (id, from_user_id, to_user_id, amount, description, category)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `);
                        insertTransaction.run([transactionId, fromUserId, toUserId, amount, description, category], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                updateSender.finalize();
                                updateRecipient.finalize();
                                insertTransaction.finalize();
                                console.error('DB Error inserting transaction:', err.message);
                                return res.status(500).json({ error: 'Payment failed due to a server error.' });
                            }

                            // Commit all changes
                            db.run('COMMIT');
                            updateSender.finalize();
                            updateRecipient.finalize();
                            insertTransaction.finalize();
                            res.json({ message: 'Payment processed successfully.', transactionId: transactionId });
                        });
                    });
                });
            });
        });
    });
});

// Start Server
app.listen(PORT, 'localhost', () => {
    console.log(`Finity backend server running on http://localhost:${PORT}`);
});