import os
import redis
import json
import time

REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
REDIS_DB = int(os.getenv('REDIS_DB', 0))

class Database:
    def __init__(self):
        self.redis = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)

    def create_auction(self, title, description, start_price, end_time, created_by):
        auction_id = self.redis.incr('auction_id')
        key = f"auction:{auction_id}"

        auction_data = {
            "id": auction_id,
            "title": title,
            "description": description,
            "start_price": float(start_price),
            "current_price": float(start_price),
            "end_time": float(end_time),
            "created_by": created_by,
            "status": "active",
            "highest_bidder": ""
        }

        # Save auction details
        self.redis.hset(key, mapping=auction_data)

        # Add to list of active auctions
        self.redis.sadd("active_auctions", auction_id)

        # Notify other API instances/clients via PubSub
        self.redis.publish("auction_updates", json.dumps({
            "auction_id": auction_id,
            "type": "new_auction"
        }))

        return auction_id

    def get_auction(self, auction_id):
        key = f"auction:{auction_id}"
        data = self.redis.hgetall(key)
        if not data:
            return None

        # Convert numeric fields
        data['id'] = int(data['id'])
        data['start_price'] = float(data['start_price'])
        data['current_price'] = float(data['current_price'])
        data['end_time'] = float(data['end_time'])

        return data

    def place_bid(self, auction_id, user, amount):
        key = f"auction:{auction_id}"
        bids_key = f"auction:{auction_id}:bids"

        # Watch the auction key for atomic transaction
        pipe = self.redis.pipeline()

        while True:
            try:
                pipe.watch(key)
                auction = pipe.hgetall(key)

                if not auction:
                    pipe.unwatch()
                    return False, "Auction not found"

                current_price = float(auction['current_price'])
                end_time = float(auction['end_time'])
                status = auction['status']

                if status != 'active':
                    pipe.unwatch()
                    return False, "Auction is not active"

                if time.time() > end_time:
                    pipe.unwatch()
                    return False, "Auction has ended"

                if amount <= current_price:
                    pipe.unwatch()
                    return False, f"Bid must be higher than {current_price}"

                # Transaction
                pipe.multi()
                pipe.hset(key, "current_price", amount)
                pipe.hset(key, "highest_bidder", user)
                pipe.zadd(bids_key, {user: amount})
                pipe.execute()

                # Publish update
                self.redis.publish("auction_updates", json.dumps({
                    "auction_id": auction_id,
                    "type": "new_bid",
                    "amount": amount,
                    "user": user
                }))

                return True, "Bid placed successfully"

            except redis.WatchError:
                continue

    def get_all_active_auctions(self):
        active_ids = self.redis.smembers("active_auctions")
        auctions = []
        for aid in active_ids:
            auction = self.get_auction(aid)
            if auction:
                auctions.append(auction)
        return auctions

    def close_auction(self, auction_id):
        key = f"auction:{auction_id}"
        self.redis.hset(key, "status", "closed")
        self.redis.srem("active_auctions", auction_id)

        # Publish finished event
        auction = self.get_auction(auction_id)
        self.redis.publish("leiloes_finalizados", json.dumps(auction))

    def get_bids(self, auction_id):
        bids_key = f"auction:{auction_id}:bids"
        # Return list of (user, amount) sorted by amount desc
        return self.redis.zrevrange(bids_key, 0, -1, withscores=True)

db = Database()

