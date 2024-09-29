import argparse
import os
from threading import Timer
import simplejson as json
from dotenv import load_dotenv
import asyncio
from websockets.asyncio.server import serve
import threading
from threading import Lock
import queue

load_dotenv()

from alpaca.data.live import StockDataStream, CryptoDataStream

s_print_lock = Lock()

def s_print(*a, **b):
    """Thread safe print function"""
    with s_print_lock:
        print(*a, **b)

parser = argparse.ArgumentParser()
parser.add_argument('api_key')
parser.add_argument('secret_key')
args = parser.parse_args()

api_key = os.environ.get('API_KEY') or args.api_key
secret_key = os.environ.get('SECRET_KEY') or args.secret_key

def crypto_data_stream_worker(data_queue, control_queue):
    async def data_handler(data):
        data_queue.put(data)

    crypto_stream = CryptoDataStream(api_key, secret_key)

    def start():
        crypto_stream.run()

    while True:
        try:
            ticks = control_queue.get(timeout=3)  # 3s timeout
            if len(ticks) > 0:
                for tick in ticks:
                    crypto_stream.subscribe_quotes(data_handler, tick)

                start_timer = Timer(0.1, start)
                start_timer.daemon = True
                start_timer.start()
            else:
                crypto_stream.stop()

        except queue.Empty:
            pass

def stock_data_stream_worker(data_queue, control_queue, ticks):
    async def data_handler(data):
        s_print(data)
        # await websocket.send(data)

    stock_stream = StockDataStream(api_key, secret_key)

    for tick in ticks:
        stock_stream.subscribe_quotes(data_handler, tick)

    stock_stream.run()

def process_data(helper):
    while True:
        try:
            data = helper.data_queues['crypto'].get(timeout=3)
            asyncio.run(helper.websocket.send(json.dumps({'symbol': data.symbol,'bid_price': data.bid_price})))

        except queue.Empty:
            pass

class AlpacaHelper:
    def __init__(self):
        self.websocket = None
        self.threads = {}
        self.data_queues = {}
        self.control_queues = {}

        self.data_queues['crypto'] = queue.Queue()
        self.control_queues['crypto'] = queue.Queue()

        self.threads['crypto'] = threading.Thread(target=crypto_data_stream_worker,
                                                  args=(self.data_queues['crypto'], self.control_queues['crypto']),
                                                  daemon=True)
        self.threads['crypto'].start()

        self.threads['websocket'] = threading.Thread(target=process_data,
                                                  args=[self],
                                                  daemon=True)
        self.threads['websocket'].start()

    def set_websocket(self, websocket):
        self.websocket = websocket

    def subscribe(self, ticks):
        self.control_queues['crypto'].put(ticks)

    def unsubscribe(self):
        self.control_queues['crypto'].put([])

alpaca_helper = AlpacaHelper()

async def handle_message(websocket):
    alpaca_helper.set_websocket(websocket)

    async for message in websocket:
        try:
            parsed_message = json.loads(message)
            if parsed_message['action'] == 'subscribe':
                alpaca_helper.subscribe(parsed_message['ticks'])

            if parsed_message['action'] == 'unsubscribe':
                alpaca_helper.subscribe(parsed_message['ticks'])

        except json.JSONDecodeError:
            print("Unable to decode message")
            await websocket.send(json.dumps({'error': 'Unable to decode message'}))
        except Exception as err:
            print("Unexpected error", err)
            await websocket.send(json.dumps({'error': 'Unexpected error'}))

async def main():
    async with serve(handle_message, "localhost", 8765):
        await asyncio.get_running_loop().create_future()

asyncio.run(main())
