from flask import Flask, request, jsonify, render_template
from flask_socketio import SocketIO, emit
from db import db
import time
import threading
import json
import redis
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# Background thread to listen to Redis PubSub
def redis_listener():
    r = redis.Redis(host=os.getenv('REDIS_HOST', 'localhost'),
                    port=int(os.getenv('REDIS_PORT', 6379)),
                    db=int(os.getenv('REDIS_DB', 0)),
                    decode_responses=True)
    p = r.pubsub()
    p.subscribe('auction_updates')

    for message in p.listen():
        if message['type'] == 'message':
            data = json.loads(message['data'])
            # Emit to all connected clients
            socketio.emit('auction_update', data)

# Background thread to check for expired auctions
def auction_monitor():
    while True:
        try:
            active_auctions = db.get_all_active_auctions()
            now = time.time()
            for auction in active_auctions:
                if now > auction['end_time']:
                    print(f"Closing auction {auction['id']}")
                    db.close_auction(auction['id'])
                    socketio.emit('auction_ended', {'auction_id': auction['id']})
            time.sleep(5)
        except Exception as e:
            print(f"Error in monitor: {e}")
            time.sleep(5)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/create-auction', methods=['POST'])
def create_auction():
    data = request.json
    title = data.get('title')
    description = data.get('description')
    start_price = data.get('start_price')
    duration = data.get('duration') # in seconds
    created_by = data.get('created_by')

    if not all([title, start_price, duration, created_by]):
        return jsonify({"error": "Missing fields"}), 400

    end_time = time.time() + float(duration)

    auction_id = db.create_auction(title, description, start_price, end_time, created_by)

    # Emit real-time update to connected clients in this process
    socketio.emit('auction_update', {
        "auction_id": auction_id,
        "type": "new_auction"
    })

    return jsonify({"message": "Auction created", "auction_id": auction_id}), 201

@app.route('/view-auctions', methods=['GET'])
def view_auctions():
    auctions = db.get_all_active_auctions()
    return jsonify(auctions)

@app.route('/auction/<int:auction_id>', methods=['GET'])
def get_auction(auction_id):
    auction = db.get_auction(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404

    bids = db.get_bids(auction_id)
    auction['bids'] = bids
    return jsonify(auction)

@app.route('/place-bid', methods=['POST'])
def place_bid():
    data = request.json
    auction_id = data.get('auction_id')
    user = data.get('user')
    amount = data.get('amount')

    if not all([auction_id, user, amount]):
        return jsonify({"error": "Missing fields"}), 400

    success, message = db.place_bid(auction_id, user, float(amount))

    if success:
        # Get latest state and broadcast to connected clients
        auction = db.get_auction(auction_id)
        socketio.emit('auction_update', {
            "auction_id": auction_id,
            "type": "new_bid",
            "current_price": auction["current_price"],
            "highest_bidder": auction["highest_bidder"]
        })
        return jsonify({
            "message": message,
            "current_price": auction["current_price"],
            "highest_bidder": auction["highest_bidder"]
        }), 200
    else:
        return jsonify({"error": message}), 400

if __name__ == '__main__':
    # Start background threads using socketio helper for compatibility
    socketio.start_background_task(redis_listener)
    socketio.start_background_task(auction_monitor)
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)

