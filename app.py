# app.py
from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import os
import requests # For calling the Gemini API

# --- Configuration ---
app = Flask(__name__)
app.config['SECRET_KEY'] = 'your_secret_key_here' # Change this to a random secret key
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///finity.db' # SQLite database file
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize extensions
db = SQLAlchemy(app)

# --- Database Models ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(120), nullable=False)
    phone = db.Column(db.String(15), nullable=True)
    balance = db.Column(db.Float, default=50000.0) # Starting balance
    expenses = db.relationship('Expense', backref='user', lazy=True)

class Expense(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    description = db.Column(db.String(200), nullable=True)
    amount = db.Column(db.Float, nullable=False)
    category = db.Column(db.String(50), nullable=False)
    date = db.Column(db.DateTime, default=db.func.current_timestamp())

# --- Routes ---
@app.route('/')
def index():
    """Render the homepage."""
    return render_template('index.html')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    phone = data.get('phone')
    # CORRECTED: Get initial balance from the request payload
    initial_balance = float(data.get('initial_balance', 50000.0))

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already exists'}), 400

    hashed_password = generate_password_hash(password)
    # CORRECTED: Pass the received initial_balance to the User model
    new_user = User(username=username, password_hash=hashed_password, phone=phone, balance=initial_balance)
    db.session.add(new_user)
    db.session.commit()

    return jsonify({'message': 'User created successfully'}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()

    if user and check_password_hash(user.password_hash, password):
        session['user_id'] = user.id
        return jsonify({
            'message': 'Login successful',
            'user': {'id': user.id, 'username': user.username, 'balance': user.balance}
        }), 200

    return jsonify({'error': 'Invalid username or password'}), 401

@app.route('/api/logout', methods=['POST'])
def logout():
    session.pop('user_id', None)
    return jsonify({'message': 'Logged out successfully'}), 200

@app.route('/api/add_expense', methods=['POST'])
def add_expense():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    user_id = session['user_id']
    description = data.get('description')
    amount = data.get('amount')
    category = data.get('category')

    user = User.query.get(user_id)
    if not user or amount > user.balance:
        return jsonify({'error': 'Insufficient balance or invalid data'}), 400

    user.balance -= amount
    new_expense = Expense(user_id=user_id, description=description, amount=amount, category=category)
    db.session.add(new_expense)
    db.session.commit()

    return jsonify({'message': 'Expense added successfully', 'new_balance': user.balance}), 201

@app.route('/api/get_expenses', methods=['GET'])
def get_expenses():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    # Get the last 5 expenses
    expenses = Expense.query.filter_by(user_id=user_id).order_by(Expense.date.desc()).limit(5).all()
    expenses_data = [
        {
            'id': exp.id,
            'description': exp.description,
            'amount': exp.amount,
            'category': exp.category,
            'date': exp.date.isoformat()
        }
        for exp in expenses
    ]
    return jsonify(expenses_data), 200

@app.route('/api/get_user_details', methods=['GET'])
def get_user_details():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    return jsonify({
        'id': user.id,
        'username': user.username,
        'phone': user.phone,
        'balance': user.balance
    }), 200

@app.route('/api/get_insights', methods=['GET'])
def get_insights():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    user_id = session['user_id']
    expenses = Expense.query.filter_by(user_id=user_id).all()

    total_spent = sum(exp.amount for exp in expenses)
    shopping_spent = sum(exp.amount for exp in expenses if exp.category == 'shopping')
    merchant_spent = sum(exp.amount for exp in expenses if exp.category == 'merchant')
    other_spent = sum(exp.amount for exp in expenses if exp.category == 'other')

    return jsonify({
        'total_spent': total_spent,
        'shopping_spent': shopping_spent,
        'merchant_spent': merchant_spent,
        'other_spent': other_spent
    }), 200

# --- Gemini Chatbot API Call ---
@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message')

    # IMPORTANT: Replace with your actual API key.
    # SECURITY WARNING: Exposing the API key in the frontend is dangerous.
    api_key = os.environ.get('GEMINI_API_KEY', 'YOUR_API_KEY_HERE')
    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key={api_key}'

    # Get user's expense data to include in the prompt
    user_expenses_data = []
    if 'user_id' in session:
        user_id = session['user_id']
        user_expenses = Expense.query.filter_by(user_id=user_id).all()
        user_expenses_data = [
            {
                'description': exp.description,
                'amount': exp.amount,
                'category': exp.category,
                'date': exp.date.isoformat()
            }
            for exp in user_expenses
        ]

    # Prepare the prompt for Gemini
    expenses_json = str(user_expenses_data) # Simple string representation
    prompt = f"""
    You are a financial advisor for students. The user has provided their expense  {expenses_json}.
    Based on this data, analyze their spending patterns and provide specific, actionable advice on how they can save money.
    Keep the advice concise, friendly, and relevant to their categories (shopping, merchant, other).
    If the user asks a specific question like "{user_message}", answer it based on the data and your financial knowledge.
    If the input is general, give general saving tips derived from the data.
    """

    headers = {
        'Content-Type': 'application/json',
    }
    payload = {
        "contents": [{
            "parts": [{
                "text": prompt
            }]
        }]
    }

    try:
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status() # Raise an exception for bad status codes
        result = response.json()
        bot_response = result.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', 'Sorry, I could not process that.')
        return jsonify({'response': bot_response.strip()})
    except requests.exceptions.RequestException as e:
        print(f"Error calling Gemini API: {e}") # Log the error
        return jsonify({'error': 'Failed to get response from AI advisor'}), 500
    except Exception as e:
        print(f"Unexpected error: {e}") # Log other errors
        return jsonify({'error': 'An unexpected error occurred'}), 500


# --- Run the application ---
if __name__ == '__main__':
    with app.app_context():
        db.create_all() # Create database tables
    app.run(debug=True, port=3000) # Run on port 3000 as in your original code
