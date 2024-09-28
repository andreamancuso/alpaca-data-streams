import argparse
import os
import array as arr

import simplejson as json
from dotenv import load_dotenv
# from fastapi import FastAPI, Response
# from fastapi.responses import StreamingResponse
# from fastapi.middleware.cors import CORSMiddleware
# import uvicorn
import asyncio
from websockets.asyncio.server import serve
import threading
from threading import Lock

load_dotenv()

from alpaca.data.live import StockDataStream, CryptoDataStream, NewsDataStream

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

def crypto_data_stream_worker(websocket, ticks):
    async def data_handler(data):
        s_print(data)
        # await websocket.send(data)

    crypto_stream = CryptoDataStream(api_key, secret_key)

    for tick in ticks:
        crypto_stream.subscribe_quotes(data_handler, tick)

    crypto_stream.run()

def stock_data_stream_worker(websocket, ticks):
    async def data_handler(data):
        s_print(data)
        # await websocket.send(data)

    stock_stream = StockDataStream(api_key, secret_key)

    for tick in ticks:
        stock_stream.subscribe_quotes(data_handler, tick)

    stock_stream.run()

class AlpacaHelper:
    def __init__(self):
        self.threads = {}

    def subscribe(self, websocket, ticks):
        self.threads['crypto'] = threading.Thread(target=crypto_data_stream_worker, args=(websocket, ticks), daemon=True).start()

alpaca_helper = AlpacaHelper()

async def handle_message(websocket):
    async for message in websocket:
        try:
            parsed_message = json.loads(message)
            await websocket.send(parsed_message['ticks'])

            alpaca_helper.subscribe(websocket, parsed_message['ticks'])

        except json.JSONDecodeError:
            print("Unable to decode message")
            await websocket.send(json.dumps({'error': 'Unable to decode message'}))
        except Exception as err:
            print("Unexpected error", err)
            await websocket.send(json.dumps({'error': 'Unexpected error'}))

async def main():
    async with serve(handle_message, "localhost", 8765):
        await asyncio.get_running_loop().create_future()

s_print("ready")

asyncio.run(main())
