import express, { Request, Response } from "express";
import { Server } from "ws";
import dotenv from "dotenv";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { AlpacaStocksClient } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/stock_websocket_v2";
import { AlpacaCryptoClient } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/crypto_websocket_v1beta3";

dotenv.config();

const API_ENDPOINT = process.env.API_ENDPOINT as string;
const API_KEY = process.env.API_KEY as string;
const API_SECRET = process.env.API_SECRET as string;

type DataStreamOptions = {
    baseUrl: string;
    apiKey: string;
    secretKey: string;
    feed?: string;
};

class DataStream {
    alpaca: Alpaca;
    socket: AlpacaCryptoClient;

    constructor({ baseUrl, apiKey, secretKey, feed }: DataStreamOptions) {
        this.alpaca = new Alpaca({
            baseUrl: baseUrl,
            keyId: apiKey,
            secretKey,
            // feed,
        });

        this.socket = this.alpaca.crypto_stream_v1beta3;
    }

    async connect() {
        return new Promise<void>((resolve, reject) => {
            this.socket.onConnect(() => {
                resolve();
            });

            this.socket.onError((err) => {
                reject(err);
            });

            this.socket.connect();
        });
    }
}

const runner = async () => {
    console.log(API_ENDPOINT, API_KEY, API_SECRET);

    const stream = new DataStream({
        baseUrl: API_ENDPOINT,
        apiKey: API_KEY,
        secretKey: API_SECRET,
        // feed: "sip",
    });

    await stream.connect();

    const wss = new Server({ port: 8765 });

    wss.on("connection", (ws) => {
        console.log("new connection established");

        ws.on("error", console.error);

        ws.on("message", function message(rawMessage) {
            const message = JSON.parse(rawMessage.toString());

            switch (message.action) {
                case "subscribe": {
                    console.log("a");
                    stream.socket.subscribeForQuotes(message.ticks);
                    console.log("b");
                    stream.socket.onCryptoQuote((quote) => {
                        ws.send(JSON.stringify(quote));
                        console.log(quote);
                    });
                    console.log("c");

                    /**
                     * {
                        T: 'q',
                        S: 'ETH/USD',
                        BidPrice: 2664.6,
                        BidSize: 10.679,
                        AskPrice: 2666.2,
                        AskSize: 21.384,
                        Timestamp: 2024-09-29T19:35:05.116Z
                        }
                     */

                    break;
                }
            }
        });
    });

    wss.on("close", () => {
        console.log("connection closed");
    });

    const app = express();

    const port = process.env.PORT as string;

    app.get("/", (request: Request, response: Response) => {
        response.status(200).send("Hello World");
    });

    app.listen(port, () => {
        console.log("Server running at PORT: ", port);
    }).on("error", (error) => {
        // gracefully handle error
        throw new Error(error.message);
    });
};

runner();
