// tlsfp: a loopback helper for claude-web's gateway (server/src/gateway/fingerprint). Node writes plain HTTP/1.1 into a
// connection to this process, prefixed with one preface line; tlsfp dials the origin (directly or through an http(s) /
// socks5 proxy), makes the real client's TLS ClientHello with uTLS, and pipes the bytes both ways. Header order and
// casing are already the client's (Node orders them), so the request bytes are passed through untouched.
//
// Preface: "CWFP/1 <token> <profile> <host> <port> <proxy-url|->\n". The token comes from TLSFP_TOKEN (set by the
// server for each start); a connection without it is closed. The process exits when its stdin closes (the server died).
//
// ClientHello specs follow CLIProxyAPI (MIT) internal/runtime/executor/helps/utls_client.go for Claude Code; the Codex
// one approximates rustls. Every spec offers only http/1.1 in ALPN: the bytes coming in are HTTP/1.1.
package main

import (
	"bufio"
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/proxy"
)

const (
	prefaceMax     = 4096
	prefaceTimeout = 10 * time.Second
	dialTimeout    = 30 * time.Second
)

var token string

func main() {
	listen := flag.String("listen", "127.0.0.1:0", "loopback address to listen on")
	flag.Parse()
	token = os.Getenv("TLSFP_TOKEN")
	if len(token) < 16 {
		fmt.Fprintln(os.Stderr, "tlsfp: TLSFP_TOKEN missing")
		os.Exit(2)
	}
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || (host != "127.0.0.1" && host != "::1" && host != "localhost") {
		fmt.Fprintln(os.Stderr, "tlsfp: -listen must be a loopback address")
		os.Exit(2)
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		fmt.Fprintln(os.Stderr, "tlsfp:", err)
		os.Exit(1)
	}
	fmt.Printf("LISTEN %s\n", ln.Addr().String())
	go func() {
		// the parent closes our stdin when it goes (or dies): never outlive it
		_, _ = io.Copy(io.Discard, os.Stdin)
		os.Exit(0)
	}()
	for {
		c, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return
			}
			time.Sleep(50 * time.Millisecond)
			continue
		}
		go handle(c)
	}
}

type preface struct {
	profile string
	host    string
	port    int
	proxy   string
}

func readPreface(br *bufio.Reader) (*preface, error) {
	var line []byte
	for {
		chunk, isPrefix, err := br.ReadLine()
		if err != nil {
			return nil, err
		}
		line = append(line, chunk...)
		if len(line) > prefaceMax {
			return nil, errors.New("preface too long")
		}
		if !isPrefix {
			break
		}
	}
	f := strings.Fields(string(line))
	if len(f) != 6 || f[0] != "CWFP/1" {
		return nil, errors.New("bad preface")
	}
	if subtle.ConstantTimeCompare([]byte(f[1]), []byte(token)) != 1 {
		return nil, errors.New("bad token")
	}
	port, err := strconv.Atoi(f[4])
	if err != nil || port <= 0 || port > 65535 {
		return nil, errors.New("bad port")
	}
	p := &preface{profile: f[2], host: f[3], port: port}
	if f[5] != "-" {
		p.proxy = f[5]
	}
	return p, nil
}

func handle(c net.Conn) {
	defer c.Close()
	br := bufio.NewReaderSize(c, 64*1024)
	_ = c.SetReadDeadline(time.Now().Add(prefaceTimeout))
	p, err := readPreface(br)
	if err != nil {
		return // not ours: say nothing
	}
	_ = c.SetReadDeadline(time.Time{})
	spec := specFor(p.profile)
	if spec == nil {
		fail(c, "unknown profile "+p.profile)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	addr := net.JoinHostPort(p.host, strconv.Itoa(p.port))
	raw, err := dial(ctx, addr, p.proxy)
	if err != nil {
		fail(c, "dial "+addr+": "+err.Error())
		return
	}
	defer raw.Close()
	uc := utls.UClient(raw, &utls.Config{
		ServerName:                         p.host,
		ClientSessionCache:                 sessionCache(p.profile + "|" + p.proxy),
		OmitEmptyPsk:                       true,
		PreferSkipResumptionOnNilExtension: true,
	}, utls.HelloCustom)
	if err := uc.ApplyPreset(spec()); err != nil {
		fail(c, "ClientHello: "+err.Error())
		return
	}
	if err := uc.HandshakeContext(ctx); err != nil {
		fail(c, "TLS handshake with "+addr+": "+err.Error())
		return
	}
	if np := uc.ConnectionState().NegotiatedProtocol; np != "" && np != "http/1.1" {
		fail(c, "server chose "+np)
		return
	}
	var once sync.Once
	done := func() { once.Do(func() { _ = uc.Close(); _ = c.Close() }) }
	go func() { _, _ = io.Copy(uc, br); done() }()
	_, _ = io.Copy(c, uc)
	done()
}

// fail answers the waiting HTTP client with a 502 the gateway can show (it then fails over like any upstream error).
func fail(c net.Conn, msg string) {
	body, _ := json.Marshal(map[string]any{"error": map[string]string{"type": "tlsfp_error", "message": "tlsfp: " + msg}})
	_, _ = fmt.Fprintf(c, "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: %d\r\n\r\n%s", len(body), body)
}

// ---- dialing (direct, http(s) CONNECT, socks5) ----

func dial(ctx context.Context, addr, proxyURL string) (net.Conn, error) {
	d := &net.Dialer{Timeout: dialTimeout, KeepAlive: 30 * time.Second}
	if proxyURL == "" {
		return d.DialContext(ctx, "tcp", addr)
	}
	u, err := url.Parse(proxyURL)
	if err != nil {
		return nil, fmt.Errorf("proxy url: %w", err)
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return connectVia(ctx, d, u, addr)
	case "socks5", "socks5h":
		var auth *proxy.Auth
		if u.User != nil {
			pw, _ := u.User.Password()
			auth = &proxy.Auth{User: u.User.Username(), Password: pw}
		}
		pd, err := proxy.SOCKS5("tcp", u.Host, auth, d)
		if err != nil {
			return nil, err
		}
		if cd, ok := pd.(proxy.ContextDialer); ok {
			return cd.DialContext(ctx, "tcp", addr)
		}
		return pd.Dial("tcp", addr)
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", u.Scheme)
	}
}

func connectVia(ctx context.Context, d *net.Dialer, u *url.URL, addr string) (net.Conn, error) {
	phost := u.Host
	if u.Port() == "" {
		if strings.EqualFold(u.Scheme, "https") {
			phost = net.JoinHostPort(u.Hostname(), "443")
		} else {
			phost = net.JoinHostPort(u.Hostname(), "80")
		}
	}
	conn, err := d.DialContext(ctx, "tcp", phost)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(u.Scheme, "https") {
		tc := tls.Client(conn, &tls.Config{ServerName: u.Hostname()})
		if err := tc.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, err
		}
		conn = tc
	}
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	req := "CONNECT " + addr + " HTTP/1.1\r\nHost: " + addr + "\r\n"
	if u.User != nil {
		pw, _ := u.User.Password()
		req += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(u.User.Username()+":"+pw)) + "\r\n"
	}
	req += "\r\n"
	if _, err := io.WriteString(conn, req); err != nil {
		conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	res, err := http.ReadResponse(br, &http.Request{Method: http.MethodConnect})
	if err != nil {
		conn.Close()
		return nil, err
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		conn.Close()
		return nil, fmt.Errorf("proxy CONNECT: %s", res.Status)
	}
	if br.Buffered() > 0 {
		conn.Close()
		return nil, errors.New("proxy sent bytes before the TLS handshake")
	}
	_ = conn.SetDeadline(time.Time{})
	return conn, nil
}

// ---- TLS session caches (one per profile + proxy, so resumption never crosses them) ----

var (
	cachesMu sync.Mutex
	caches   = map[string]utls.ClientSessionCache{}
)

func sessionCache(key string) utls.ClientSessionCache {
	cachesMu.Lock()
	defer cachesMu.Unlock()
	if c, ok := caches[key]; ok {
		return c
	}
	if len(caches) >= 64 {
		for k := range caches {
			delete(caches, k)
			break
		}
	}
	c := utls.NewLRUClientSessionCache(32)
	caches[key] = c
	return c
}
