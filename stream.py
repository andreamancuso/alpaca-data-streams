from alpaca.data.live import StockDataStream


wss_client = StockDataStream('', '')

# async handler
async def quote_data_handler(data):
    # quote data will arrive here
    print(data)

wss_client.subscribe_quotes(quote_data_handler, "SPY")

wss_client.run()