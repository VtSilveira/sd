from locust import HttpUser, task, between
import random

class AuctionUser(HttpUser):
    wait_time = between(1, 5)

    def on_start(self):
        # Create an auction to bid on
        self.client.post("/create-auction", json={
            "title": "Load Test Item",
            "description": "Item for load testing",
            "start_price": 100,
            "duration": 300,
            "created_by": "LoadTester"
        })

    @task(3)
    def view_auctions(self):
        self.client.get("/view-auctions")

    @task(1)
    def place_bid(self):
        # Get active auctions
        response = self.client.get("/view-auctions")
        auctions = response.json()

        if auctions:
            auction = random.choice(auctions)
            current_price = auction['current_price']

            self.client.post("/place-bid", json={
                "auction_id": auction['id'],
                "user": "LoadUser",
                "amount": current_price + random.randint(1, 10)
            })

