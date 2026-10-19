import express, { Request, Response } from "express";
import { db, users } from "../db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { check, validationResult } from "express-validator";
import verifyToken from "../middleware/auth";
import { authLimiter } from "../middleware/rateLimiter";

const router = express.Router();

const createTokens = (userId: string, userRole: string) => {
    if (!process.env.JWT_SECRET_KEY || !process.env.REFRESH_SECRET_KEY) {
        throw new Error("Server configuration error: Token keys missing.");
    }
    
    const accessToken = jwt.sign(
        { userId, userRole },
        process.env.JWT_SECRET_KEY as string,
        {
            expiresIn: "15m",
        }
    );

    const refreshToken = jwt.sign(
        { userId },
        process.env.REFRESH_SECRET_KEY as string,
        {
            expiresIn: "7d",
        }
    );

    return { accessToken, refreshToken };
};


router.post(
    "/register",
    authLimiter, 
    [
        check("firstName", "First Name is required").isString(),
        check("lastName", "Last Name is required").isString(),
        check("email", "Email is required").isEmail(),
        check("password", "Password with 8 or more characters required").isLength({
            min: 8,
        }),
    ],
    async (req: Request, res: Response) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array() });
        }

        try {
            const { firstName, lastName, email, password } = req.body;

            const [existing] = await db
                .select({ _id: users._id })
                .from(users)
                .where(eq(users.email, email))
                .limit(1);

            if (existing) {
                return res.status(400).json({ message: "User already exists" });
            }

            const hashedPassword = await bcrypt.hash(password, 8);

            const [user] = await db
                .insert(users)
                .values({ firstName, lastName, email, password: hashedPassword })
                .returning();

            const { accessToken, refreshToken } = createTokens(user._id, user.role);

            res.cookie("auth_token", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 15 * 60 * 1000, // 15 minuta
                path: "/",
            });

            res.cookie("refresh_token", refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dana
                path: "/",
            });

            return res.status(200).send({ message: "User registered OK", userId: user._id });
        } catch (error) {
            res.status(500).send({ message: "Something went wrong on the server" });
        }
    }
);


router.get("/me", verifyToken, async (req: Request, res: Response) => {
    const userId = req.userId;

    try {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users._id, userId))
            .limit(1);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const { password: _password, ...safeUser } = user;
        res.json(safeUser);
    } catch (error) {
        res.status(500).json({ message: "Something went wrong on the server" });
    }
});

export default router;