// import express, { Request, Response } from "express";
import { Server } from "ws";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";
import Alpaca from "@alpacahq/alpaca-trade-api";
import { AlpacaCryptoClient } from "@alpacahq/alpaca-trade-api/dist/resources/datav2/crypto_websocket_v1beta3";
import { backOff } from "exponential-backoff";
import { Mutex } from "async-mutex";

dotenv.config();

const API_ENDPOINT = process.env.API_ENDPOINT as string;
const API_KEY = process.env.API_KEY as string;
const API_SECRET = process.env.API_SECRET as string;
const port = process.env.PORT as string;

type DataStreamOptions = {
    baseUrl: string;
    apiKey: string;
    secretKey: string;
    feed?: string;
};

class DataStream {
    alpaca: Alpaca;
    socket: AlpacaCryptoClient;
    mutex: Mutex;
    isConnected = false;

    constructor({ baseUrl, apiKey, secretKey, feed }: DataStreamOptions) {
        this.mutex = new Mutex();

        this.alpaca = new Alpaca({
            baseUrl: baseUrl,
            keyId: apiKey,
            secretKey,
            // feed,
        });

        this.socket = this.alpaca.crypto_stream_v1beta3;
    }

    async connect() {
        const release = await this.mutex.acquire();

        if (this.isConnected) {
            return;
        }

        return new Promise<void>((resolve, reject) => {
            this.socket.onConnect(() => {
                console.log("Connected to Alpaca");
                this.isConnected = true;
                release();
                resolve();
            });

            this.socket.onError((err) => {
                release();
                reject(err);
            });

            this.socket.connect();
        });
    }
}

const runner = async () => {
    const passkey = uuidv4();

    console.log(`Using passkey ${passkey}`);

    const stream = new DataStream({
        baseUrl: API_ENDPOINT,
        apiKey: API_KEY,
        secretKey: API_SECRET,
    });

    // await backOff(() => stream.connect(), {
    //     delayFirstAttempt: true,
    //     startingDelay: 5000,
    //     numOfAttempts: 3,
    // });

    const wss = new Server({ host: "0.0.0.0", port: Number(port) });

    wss.on("connection", (ws) => {
        console.log("new connection established");

        ws.on("error", console.error);

        ws.on("message", async (rawMessage) => {
            try {
                const message = JSON.parse(rawMessage.toString());

                if (message.passkey === passkey) {
                    await stream.connect();

                    switch (message.action) {
                        case "subscribe": {
                            stream.socket.subscribeForQuotes(message.ticks);
                            stream.socket.onCryptoQuote((quote) => {
                                ws.send(JSON.stringify(quote));
                            });
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
                } else {
                    ws.close(4001, JSON.stringify({ message: "Unauthorized" }));
                }
            } catch (error) {
                console.error(error);

                ws.close();
            }
        });

        ws.on("close", () => {
            console.log("connection closed");
        });
    });

    // const app = express();

    // app.get("/", (request: Request, response: Response) => {
    //     response.status(200).send("Hello World");
    // });

    // app.listen(port, () => {
    //     console.log("Server running at PORT: ", port);
    // }).on("error", (error) => {
    //     // gracefully handle error
    //     throw new Error(error.message);
    // });
};

runner();
