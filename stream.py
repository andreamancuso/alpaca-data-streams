import argparse
import os
from dotenv import load_dotenv
load_dotenv()

from alpaca.data.live import StockDataStream

parser = argparse.ArgumentParser()
parser.add_argument('api_key')
parser.add_argument('secret_key')
args = parser.parse_args()

api_key = os.environ.get('API_KEY') or args.api_key
secret_key = os.environ.get('SECRET_KEY') or args.secret_key

wss_client = StockDataStream(api_key, secret_key)

# async handler
async def quote_data_handler(data):
    # quote data will arrive here
    print(data)

wss_client.subscribe_quotes(quote_data_handler, "SPY")

wss_client.run()