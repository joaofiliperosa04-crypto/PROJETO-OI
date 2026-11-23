  require("dotenv").config();
    const express = require("express");
    const mysql = require("mysql2/promise");
    const bcrypt = require("bcrypt");
    const jwt = require("jsonwebtoken")
    const cookieParser = require("cookie-parser");
    const path = require("path");
const { buffer } = require("stream/consumers");
const { throwDeprecation } = require("process");
    const app = express();
    app.use(express.json())
 
    app.use(express.static(path.join(__dirname, "public")))
    app.use(cookieParser());
 
    const db = mysql.createPool({
        host: process.env.HOST,
        port: process.env.PORT,
        user: process.env.USER,
        database: process.env.DB_NAME
    })
 
    async function iniciar() {
        try {
            const [usuario] = await db.execute("SELECT id FROM usuario WHERE email = ?", [process.env.ADMIN_EMAIL])
            if (usuario.length === 0) {
                const senhaHash = await bcrypt.hash(process.env.ADMIN_SENHA, 10)
                await db.execute("INSERT INTO usuario (email, senha) VALUES (?,?)", [process.env.ADMIN_EMAIL, senhaHash])
                console.log("Admin criado")
            }
        } catch (erro) {
            console.log("Não foi possivel conectar com o banco de dados")
        }
    }
 
    app.post("/api/atendimento", async (req,res) => {
        try {
            const {tutor, pet, especie, servico, valor, data} = req.body;
 
            if(!tutor || !pet || !especie || !servico || !Number(valor) || !data) {
                return res.status(400).json ({erro: "Confira todos os campos"})
            }
 
            if (valor <=0) {
                return res.status(400).json ({erro: 'valor deve ser maior que 0.'})
            }
 
            const [resultado] = await db.execute (
                `INSERT INTO atendimento (tutor, pet, especie, servico, valor, data_atendimento) VALUES (?,?,?,?,?,?)`, [tutor.trim(), pet.trim(), especie, servico, Number(valor), data]
            )
 
            res.status(201).json({mensagem: "Atendimento salvo", id: resultado.insertId})
        } catch (erro) {
            console.log(erro)
            res.status(500).json({erro: "erro de conexao com o banco"})
        }
    })
 
    app.post("/api/login", async (req, res) => {
        try {
            const {email, senha} = req.body;
            if (!email || !senha) {
                return res.status(400).json({erro: "Informe e-mail e senha!"})
            }
            const [usuario] = await db.execute ("SELECT id, email, senha FROM usuario WHERE email = ?", [email.trim()])
            if(usuario.length === 0) {
                return res.status(401).json({erro: "Credenciais incorretas."})
            }
            const dados = usuario[0]
            const senhaCorreta = await bcrypt.compare(senha, dados.senha)
            if(!senhaCorreta) {
                return res.status(401).json({erro: "Credenciais invalidas"})
            }
 
            const token = jwt.sign (
                {id: dados.id, email: dados.email},
                process.env.JWT_SEGREDO,
                {expiresIn: "1h"}
            )
 
            res.cookie("token", token, {
                httpOnly: true,
                secure: process.env.NODE === "production",
                sameSite: "strict",
                maxAge: 60*60*1000
            })
 
            res.json({mensagem: "Login Realizado"})
        } catch(erro) {
            res.status(500).json({erro: "Erro de conexao com o banco de dados"})
        }
    })
 
    function autenticar(req, res, next) {
        const token = req.cookies.token;
        if(!token) {
            return res.status(401).json({erro: "Você precisa fazer login para acessar esta pagina"})
        }
 
        try {
            req.usuario = jwt.verify(token, process.env.JWT_SEGREDO);
            next()
        } catch(erro) {
            res.clearCookie("token")
            res.redirect("/login.html")
            return res.status(401).json({erro: "Sessão inválida ou expirada."})
        }
    }
 
    app.get("/dashboard", autenticar, (req, res) => {
        res.sendFile(path.join(__dirname, "private", "dashboard.html"))
    })
 
    app.get("/api/verificar", autenticar, (req, res) => {
        res.json({autenticado: true, usuario: req.usuario})
    })
 
    app.post("/api/logout", (req, res) => {
        res.clearCookie("token", {httpOnly: true, sameSite: "strict", secure: process.env.NODE === "production"})
            res.json({mensagem: "logout efetuado"})
    })
 
    app.get("/api/graficos", autenticar, async (req, res) => {
        try {
            const [atendimentos] = await db.execute(`SELECT tutor, pet, especie, servico FROM atendimento`)
            const resposta = await fetch("http://127.0.0.1:5001/graficos", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ atendimentos })
            })
 
            if (!resposta.ok) {
                throw new Error("O python nao conseguiu gerar graficos")
            }
 
            const imagem = Buffer.from(await resposta.arrayBuffer())
            res.setHeader("Content-Type", "image/png")
            res.setHeader("Content-Disposition", "inline; filename=graficos.png")
            res.send(imagem)
        } catch (erro) {
            console.log(erro)
            res.status(500).json({ erro: "Erro de comunicação com o Python" })
        }
    })
 
    app.get("/api/pdf", autenticar, async (req,res) => {
        try {
        const [atendimentos] = await db.execute(`
            SELECT tutor, pet, especie, servico, valor FROM atendimento ORDER_BY criacao_em
            `)
            const resposta = await fetch("http://127.0.0.1:5001//pdf", {
                method: "POST",
                headers: {"Content-Type": "application.json"},
                body: JSON.stringify({atendimentos})
            })
            if(!resposta.ok) {
                throw new Error("O python não conseguiu gerar o pdf")
            }
            const pdf = Buffer.from(await resposta.arrayBuffer())
            res.setHeader("Content-Type", "application/pdf")
            res.setHeader("Content-Disposition", "attachment; filename='relatorio-petshop.pdf'")
            res.send(pdf)
        }catch(erro) {
            res.status(500).json({erro: "Erro de comunicação com o python"})
        }
    })
 
    app.listen(3000, () => {
        iniciar()
        console.log("Servidor rodando em localhost:3000")
    })