package card51;

import java.util.*;

public class Player {
    private final List<Card> hand = new ArrayList<>();
    private boolean opened = false;
    private final List<List<Card>> openGroups = new ArrayList<>();

    public void addCard(Card c) {
        hand.add(c);
    }

    public void removeCard(Card c) {
        hand.remove(c);
    }

    public List<Card> getHand() {
        return hand;
    }

    public boolean hasOpened() {
        return opened;
    }

    public void open() {
        opened = true;
    }

    public void addGroup(List<Card> g) {
        openGroups.add(new ArrayList<>(g));
    }

    public List<List<Card>> getGroups() {
        return openGroups;
    }

    public void showHand() {
        System.out.println("Your hand:");
        for (int i = 0; i < hand.size(); i++) {
            System.out.printf("%2d: %s%n", i + 1, hand.get(i));
        }
    }
}