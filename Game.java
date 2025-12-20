package card51;

import java.util.*;
import static card51.GroupValidator.AceMode;

public class Game {
    private Deck deck = new Deck();
    private List<Player> players = new ArrayList<>();
    private Scanner input = new Scanner(System.in);

    public Game(int numPlayers) {
        for (int i = 0; i < numPlayers; i++)
            players.add(new Player());
        deal();
    }

    private void deal() {
        for (Player p : players)
            for (int j = 0; j < 14; j++)
                p.addCard(deck.draw());
    }

    public void start() {
        int turn = 0;
        while (true) {
            Player p = players.get(turn);
            System.out.printf("\nPlayer %d's turn%n", turn + 1);
            p.showHand();

            // DRAW PHASE
            System.out.println("Draw from (1) Deck or (2) Discard?");
            int choice = input.nextInt();
            Card drawn;
            if (choice == 2 && p.hasOpened() && !deck.isDiscardEmpty())
                drawn = deck.pullDiscard();
            else {
                drawn = deck.draw();
                if (choice == 2) {
                    String msg = !p.hasOpened()
                            ? "You have not yet opened, drawing from the deck."
                            : "Discard pile is empty, drawing from the deck.";
                    System.out.println(msg);
                }
            }
            p.addCard(drawn);
            System.out.println("Drew: " + drawn);

            // OPENING LOGIC
            if (!p.hasOpened()) {
                List<List<Card>> candidates = new ArrayList<>();
                candidates.addAll(GameUtils.findSets(p.getHand()));
                candidates.addAll(GameUtils.findRuns(p.getHand(), AceMode.LOW));
                candidates.addAll(GameUtils.findRuns(p.getHand(), AceMode.HIGH));

                List<List<Card>> openables = new ArrayList<>();
                for (List<Card> g : candidates) {
                    if (g.contains(drawn) && GroupValidator.getGroupPoints(g) >= 51)
                        openables.add(g);
                }
                if (!openables.isEmpty()) {
                    System.out.println("You can open! Choose a group:");
                    for (int i = 0; i < openables.size(); i++)
                        System.out.printf("%2d: %s (points %d)%n", i + 1, openables.get(i),
                                GroupValidator.getGroupPoints(openables.get(i)));
                    int sel = input.nextInt() - 1;
                    List<Card> chosen = openables.get(sel);
                    if (p.getHand().size() - chosen.size() < 1) {
                        System.out.println("Must keep one card to discard. Opening canceled.");
                    } else {
                        for (Card c : chosen)
                            p.removeCard(c);
                        p.addGroup(chosen);
                        p.open();
                        System.out.println("Opened with: " + chosen);
                    }
                }
            } else {
                // POST-OPEN: additional melds
                System.out.println("Lay a new meld? (1) Yes (2) No");
                if (input.nextInt() == 1) {
                    List<List<Card>> all = new ArrayList<>();
                    all.addAll(GameUtils.findSets(p.getHand()));
                    all.addAll(GameUtils.findRuns(p.getHand(), AceMode.LOW));
                    all.addAll(GameUtils.findRuns(p.getHand(), AceMode.HIGH));
                    for (int i = 0; i < all.size(); i++)
                        System.out.printf("%2d: %s (points %d)%n", i + 1, all.get(i),
                                GroupValidator.getGroupPoints(all.get(i)));
                    int sel = input.nextInt() - 1;
                    List<Card> chosen = all.get(sel);
                    if (p.getHand().size() - chosen.size() < 1) {
                        System.out.println("Must leave one card to discard.");
                    } else {
                        for (Card c : chosen)
                            p.removeCard(c);
                        p.addGroup(chosen);
                        System.out.println("Laid meld: " + chosen);
                    }
                }
            }

            p.showHand();
            // DISCARD PHASE
            System.out.println("Select card to discard:");
            int d = input.nextInt() - 1;
            Card disc = p.getHand().get(d);
            p.removeCard(disc);
            deck.discard(disc);
            System.out.println("Discarded: " + disc);

            // WIN CHECK
            if (p.getHand().isEmpty()) {
                System.out.printf("Player %d wins!%n", turn + 1);
                break;
            }
            turn = (turn + 1) % players.size();
        }
    }

    public static void main(String[] args) {
        System.out.println("Welcome to Card 51!");
        new Game(2).start();
    }
}