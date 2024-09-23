import argparse
import os
from dotenv import load_dotenv
from fastapi import FastAPI, Response
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
load_dotenv()

from alpaca.data.live import StockDataStream

parser = argparse.ArgumentParser()
parser.add_argument('api_key')
parser.add_argument('secret_key')
args = parser.parse_args()

api_key = os.environ.get('API_KEY') or args.api_key
secret_key = os.environ.get('SECRET_KEY') or args.secret_key

wss_client = StockDataStream(api_key, secret_key)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# async handler
def quote_data_handler(data):
    # quote data will arrive here
    yield data

wss_client.subscribe_quotes(quote_data_handler, "SPY")

wss_client.run()

@app.get("/stock")
async def root():
    return StreamingResponse(quote_data_handler(), media_type="text/event-stream")


uvicorn.run(app, host="127.0.0.1", port=8000)